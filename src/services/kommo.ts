import axios, { AxiosInstance } from "axios";
import { KommoConfig, Lead, Message } from "../types/index.js";
import qs from "qs";
import { loadTokens, saveTokens, loadTokensFromTenant, saveTokensToTenant } from "./token-store.js";
import { sendTokenAlertEmail } from "../api/services/email.js";

// Cooldown de 6h para alertas de token por time
const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export class KommoService {
    public client: AxiosInstance;
    public config: KommoConfig;
    private currentAccessToken: string;
    public readonly team: string;
    public readonly tenantId?: string;
    private tokenLoaded = false;

    constructor(config: KommoConfig, team: string, tenantId?: string) {
        this.config = config;
        this.team = team;
        this.tenantId = tenantId;
        this.currentAccessToken = config.accessToken ?? "";
        this.client = axios.create({
            baseURL: `https://${config.subdomain}.kommo.com/api/v4`,
            timeout: 15_000, // 15 seconds — fail fast instead of hanging
            headers: {
                "Content-Type": "application/json",
            },
            paramsSerializer: {
                serialize: (params) => qs.stringify(params, { arrayFormat: 'brackets' })
            }
        });

        // Set initial token via the canonical channel so loadStoredToken() always overrides it
        this.setAccessToken(this.currentAccessToken);

        // Lazy-load stored token on first request (covers tenant-created services)
        this.client.interceptors.request.use(async (reqConfig) => {
            if (!this.tokenLoaded) {
                this.tokenLoaded = true;
                await this.loadStoredToken();
                reqConfig.headers["Authorization"] = `Bearer ${this.currentAccessToken}`;
            }
            return reqConfig;
        });

        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const original = error.config;
                if (error.response?.status === 401 && !original._retried) {
                    original._retried = true;
                    try {
                        const newToken = await this.refreshAccessToken();
                        original.headers["Authorization"] = `Bearer ${newToken}`;
                        return this.client(original);
                    } catch (refreshErr) {
                        console.error(`[KommoService:${this.team}] Token refresh failed:`, refreshErr);
                    }
                }
                return Promise.reject(error);
            }
        );
    }

    /** Called once on startup: loads the latest token from Supabase if available */
    public async loadStoredToken(): Promise<void> {
        try {
            const stored = this.tenantId
                ? await loadTokensFromTenant(this.tenantId)
                : await loadTokens(this.team);
            if (stored?.accessToken && stored.accessToken !== this.currentAccessToken) {
                console.log(`[KommoService:${this.team}] Using stored access token from Supabase`);
                this.setAccessToken(stored.accessToken);
            }
        } catch (e) {
            console.warn(`[KommoService:${this.team}] Could not load stored token, using env token:`, e);
        }
    }

    private setAccessToken(token: string): void {
        this.currentAccessToken = token;
        this.client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }

    /** Exchange a refresh_token for a new access_token + refresh_token (with retry + backoff) */
    public async refreshAccessToken(): Promise<string> {
        const stored = this.tenantId
            ? await loadTokensFromTenant(this.tenantId)
            : await loadTokens(this.team);
        if (!stored?.refreshToken) {
            throw new Error(`[${this.team}] No refresh token available. Please re-authorize via the admin panel.`);
        }

        const delays = [5_000, 15_000, 30_000]; // 5s, 15s, 30s backoff
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`[KommoService:${this.team}] Refreshing access token (attempt ${attempt}/3)...`);
                const response = await axios.post(
                    `https://${this.config.subdomain}.kommo.com/oauth2/access_token`,
                    {
                        client_id: this.config.clientId,
                        client_secret: this.config.clientSecret,
                        grant_type: "refresh_token",
                        refresh_token: stored.refreshToken,
                        redirect_uri: this.config.redirectUri,
                    }
                );

                const { access_token, refresh_token, expires_in, server_time } = response.data;
                const expiresAt = (server_time || Math.floor(Date.now() / 1000)) + (expires_in || 86400);
                if (this.tenantId) {
                    await saveTokensToTenant(this.tenantId, { accessToken: access_token, refreshToken: refresh_token, expiresAt });
                } else {
                    await saveTokens(this.team, { accessToken: access_token, refreshToken: refresh_token, expiresAt });
                }
                this.setAccessToken(access_token);
                console.log(`[KommoService:${this.team}] Token refreshed and saved. Expires at ${new Date(expiresAt * 1000).toISOString()}`);
                return access_token;
            } catch (e: any) {
                lastError = e;
                console.error(`[KommoService:${this.team}] Refresh attempt ${attempt}/3 failed:`, e.message);
                if (attempt < 3) {
                    const delay = delays[attempt - 1];
                    console.log(`[KommoService:${this.team}] Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error(`[${this.team}] Token refresh failed after 3 attempts`);
    }

    /** Refresh the token proactively if it expires within 6 hours (or has no recorded expiry) */
    public async proactiveRefresh(): Promise<void> {
        try {
            const stored = this.tenantId
                ? await loadTokensFromTenant(this.tenantId)
                : await loadTokens(this.team);
            if (!stored?.refreshToken) {
                console.warn(`[KommoService:${this.team}] Proactive refresh skipped: no refresh token stored`);
                return;
            }
            const now = Math.floor(Date.now() / 1000);
            const sixHours = 6 * 60 * 60;
            if (!stored.expiresAt || stored.expiresAt - now < sixHours) {
                const hoursLeft = stored.expiresAt ? Math.round((stored.expiresAt - now) / 3600) : NaN;
                console.log(`[KommoService:${this.team}] Proactive refresh triggered (${isNaN(hoursLeft) ? 'expiry unknown' : `${hoursLeft}h left`})`);
                await this.refreshAccessToken();
            } else {
                const hoursLeft = Math.round((stored.expiresAt - now) / 3600);
                console.log(`[KommoService:${this.team}] Token healthy — ~${hoursLeft}h remaining, no refresh needed`);
            }
        } catch (e: any) {
            console.error(`[KommoService:${this.team}] Proactive refresh failed:`, e.message);
            await this.sendRefreshFailureAlert(e.message);
        }
    }

    /** Send email alert to tenant admins when token refresh fails (with 6h cooldown) */
    private async sendRefreshFailureAlert(errorMessage: string): Promise<void> {
        const cooldownKey = `${this.tenantId || "env"}:${this.team}`;
        const lastAlert = alertCooldowns.get(cooldownKey) || 0;
        if (Date.now() - lastAlert < ALERT_COOLDOWN_MS) {
            console.log(`[KommoService:${this.team}] Alert cooldown active, skipping email`);
            return;
        }

        try {
            // Dynamically import supabase to avoid circular dependency
            const { supabase } = await import("../api/supabase.js");
            let adminEmails: string[] = [];

            if (this.tenantId) {
                const { data: admins } = await supabase
                    .from("profiles")
                    .select("email")
                    .eq("tenant_id", this.tenantId)
                    .in("role", ["admin", "superadmin"])
                    .eq("status", "approved");
                adminEmails = (admins || []).map((a: { email: string }) => a.email);
            }

            if (adminEmails.length > 0) {
                await sendTokenAlertEmail(this.team, errorMessage, adminEmails);
                alertCooldowns.set(cooldownKey, Date.now());
                console.log(`[KommoService:${this.team}] Alert sent to ${adminEmails.length} admins`);
            } else {
                console.warn(`[KommoService:${this.team}] No admin emails found for alert`);
            }
        } catch (alertErr: any) {
            console.error(`[KommoService:${this.team}] Failed to send alert email:`, alertErr.message);
        }
    }

    /** Exchange an authorization code for access_token + refresh_token (OAuth step 2) */
    public async exchangeAuthCode(code: string): Promise<{ accessToken: string; refreshToken: string }> {
        const response = await axios.post(
            `https://${this.config.subdomain}.kommo.com/oauth2/access_token`,
            {
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                grant_type: "authorization_code",
                code,
                redirect_uri: this.config.redirectUri,
            }
        );

        const { access_token, refresh_token, expires_in, server_time } = response.data;
        const expiresAt = (server_time || Math.floor(Date.now() / 1000)) + (expires_in || 86400);
        await saveTokens(this.team, { accessToken: access_token, refreshToken: refresh_token, expiresAt });
        this.setAccessToken(access_token);
        console.log(`[KommoService:${this.team}] Authorization code exchanged, tokens saved. Expires at ${new Date(expiresAt * 1000).toISOString()}`);
        return { accessToken: access_token, refreshToken: refresh_token };
    }

    public async getRecentLeads(limit: number = 10): Promise<Lead[]> {
        try {
            const response = await this.client.get("/leads", {
                params: {
                    limit,
                    order: "created_at",
                }
            });
            return response.data?._embedded?.leads || [];
        } catch (error) {
            console.error("Error fetching leads:", error);
            throw error;
        }
    }

    public async getLeadDetails(id: number): Promise<Lead> {
        try {
            const response = await this.client.get(`/leads/${id}`, {
                params: {
                    with: "contacts"
                }
            });
            return response.data;
        } catch (error) {
            console.error(`Error fetching lead ${id}:`, error);
            throw error;
        }
    }

    public async getLeadNotes(id: number): Promise<any[]> {
        try {
            const response = await this.client.get(`/leads/${id}/notes`);
            return response.data?._embedded?.notes || [];
        } catch (error) {
            console.error(`Error fetching notes for lead ${id}:`, error);
            throw error;
        }
    }

    public async addNote(leadId: number, text: string): Promise<any> {
        try {
            const response = await this.client.post(`/leads/${leadId}/notes`, [
                {
                    note_type: "common",
                    params: {
                        text: text,
                    },
                },
            ]);
            return response.data;
        } catch (error) {
            console.error(`Error adding note to lead ${leadId}:`, error);
            throw error;
        }
    }

    public async getGroups(): Promise<Array<{ id: number; name: string }>> {
        try {
            const response = await this.client.get("/groups");
            const raw = response.data;
            const groups = raw?._embedded?.groups || raw?.groups || (Array.isArray(raw) ? raw : []);
            if (groups.length > 0) {
                console.log(`[Kommo] /groups returned ${groups.length} groups`);
                return groups.map((g: any) => ({ id: g.id, name: g.name }));
            }
            console.log(`[Kommo] /groups returned empty, trying /groups/{id} for each unique user group`);
            return [];
        } catch (error: any) {
            console.log(`[Kommo] /groups failed (${error?.response?.status}), will resolve from users`);
            return [];
        }
    }

    public async getGroupById(groupId: number): Promise<{ id: number; name: string } | null> {
        // Try multiple Kommo API paths for group resolution
        const paths = [`/groups/${groupId}`, `/users/groups/${groupId}`];
        for (const path of paths) {
            try {
                const response = await this.client.get(path);
                const data = response.data;
                if (data?.name) return { id: data.id || groupId, name: data.name };
            } catch {}
        }
        return null;
    }

    public async getAccountInfo(): Promise<any> {
        try {
            const response = await this.client.get("/account", {
                params: { with: "amojo_id,amojo_rights,users_groups,task_types,datetime_settings" }
            });
            return response.data;
        } catch {
            // Try without params
            try {
                const response = await this.client.get("/account");
                return response.data;
            } catch {
                return null;
            }
        }
    }

    public async getUsers(): Promise<any[]> {
        try {
            const response = await this.client.get("/users");
            return response.data?._embedded?.users || [];
        } catch (error) {
            console.error("Error fetching users:", error);
            throw error;
        }
    }

    public async getEvents(params: { filter?: any; limit?: number } = {}): Promise<any[]> {
        try {
            const response = await this.client.get("/events", {
                params: {
                    limit: params.limit || 100,
                    filter: params.filter,
                },
            });
            return response.data?._embedded?.events || [];
        } catch (error) {
            console.error("Error fetching events:", error);
            throw error;
        }
    }

    public async closeLeadAsLost(leadId: number, lossReasonId?: number): Promise<boolean> {
        try {
            const body: any = { id: leadId, status_id: 143 };
            if (lossReasonId) body.loss_reason_id = lossReasonId;
            await this.client.patch("/leads", [body]);
            return true;
        } catch (error: any) {
            console.error(`[Kommo] Erro ao fechar lead ${leadId} como perdido:`, error.message);
            return false;
        }
    }

    public async getLossReasons(): Promise<Array<{ id: number; name: string }>> {
        try {
            const response = await this.client.get("/leads/loss_reasons");
            const reasons = response.data?._embedded?.loss_reasons || [];
            return reasons.map((r: any) => ({ id: r.id, name: r.name }));
        } catch (error) {
            console.error("Error fetching loss reasons:", error);
            return [];
        }
    }

    public async getPipelines(): Promise<any[]> {
        try {
            const response = await this.client.get("/leads/pipelines");
            return response.data?._embedded?.pipelines || [];
        } catch (error) {
            console.error("Error fetching pipelines:", error);
            throw error;
        }
    }

    public async getLeads(params: { limit?: number; filter?: any; sort?: any } = {}): Promise<Lead[]> {
        try {
            let allLeads: Lead[] = [];
            let page = 1;
            const limit = params.limit || 250;

            while (true) {
                if (page % 10 === 1) console.log(`[Kommo] Fetching leads page ${page}...`);
                const response = await this.client.get("/leads", {
                    params: {
                        limit: limit,
                        page: page,
                        with: "custom_fields_values,contacts",
                        filter: params.filter,
                        sort: params.sort
                    }
                });

                const leads = response.data?._embedded?.leads || [];
                if (leads.length === 0) break;

                allLeads = allLeads.concat(leads);

                if (leads.length < limit) break;

                if (page > 100) {
                    console.warn("[Kommo] Reached 100 pages of leads, stopping for safety.");
                    break;
                }

                page++;
            }

            console.log(`[Kommo] Total leads fetched: ${allLeads.length}`);
            return allLeads;
        } catch (error) {
            console.error("Error fetching leads:", error);
            return [];
        }
    }

    /**
     * Fetch all contacts with custom_fields_values (paginated).
     * Returns raw Kommo contact objects.
     */
    public async getContacts(): Promise<any[]> {
        try {
            let allContacts: any[] = [];
            let page = 1;
            const limit = 250;

            while (true) {
                if (page % 10 === 1) console.log(`[Kommo] Fetching contacts page ${page}...`);
                const response = await this.client.get("/contacts", {
                    params: {
                        limit,
                        page,
                        with: "custom_fields_values",
                    },
                });

                const contacts = response.data?._embedded?.contacts || [];
                if (contacts.length === 0) break;

                allContacts = allContacts.concat(contacts);

                if (contacts.length < limit) break;
                if (page > 100) {
                    console.warn("[Kommo] Reached 100 pages of contacts, stopping for safety.");
                    break;
                }
                page++;
            }

            console.log(`[Kommo] Total contacts fetched: ${allContacts.length}`);
            return allContacts;
        } catch (error) {
            console.error("Error fetching contacts:", error);
            return [];
        }
    }

    /**
     * Get all notes for a lead with pagination.
     * Kommo stores chat messages as notes of type "message_cashier" or text notes.
     * Returns all notes sorted by created_at ascending.
     */
    public async getLeadNotesAll(leadId: number): Promise<Array<{
      id: number;
      note_type: string;
      text: string;
      created_at: number;
      responsible_user_id: number;
      params?: { text?: string };
    }>> {
      try {
        const allNotes: any[] = [];
        let page = 1;

        while (true) {
          const response = await this.client.get(`/leads/${leadId}/notes`, {
            params: { page, limit: 250 },
          });
          const notes = response.data?._embedded?.notes || [];
          if (notes.length === 0) break;
          allNotes.push(...notes);
          if (notes.length < 250) break;
          if (page > 10) break; // safety
          page++;
        }

        return allNotes.sort((a: any, b: any) => a.created_at - b.created_at);
      } catch (error) {
        console.error(`Error fetching notes for lead ${leadId}:`, error);
        return [];
      }
    }
}
