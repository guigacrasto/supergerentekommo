import axios, { AxiosInstance } from "axios";
import { KommoConfig, Lead, Message } from "../types/index.js";
import qs from "qs";
import { loadTokens, saveTokens } from "./token-store.js";
import { TeamKey } from "../config.js";

export class KommoService {
    public client: AxiosInstance;
    private config: KommoConfig;
    private currentAccessToken: string;
    private team: TeamKey;

    constructor(config: KommoConfig, team: TeamKey) {
        this.config = config;
        this.team = team;
        this.currentAccessToken = config.accessToken ?? "";
        this.client = axios.create({
            baseURL: `https://${config.subdomain}.kommo.com/api/v4`,
            headers: {
                Authorization: `Bearer ${config.accessToken}`,
                "Content-Type": "application/json",
            },
            paramsSerializer: {
                serialize: (params) => qs.stringify(params, { arrayFormat: 'brackets' })
            }
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
            const stored = await loadTokens(this.team);
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

    /** Exchange a refresh_token for a new access_token + refresh_token */
    public async refreshAccessToken(): Promise<string> {
        const stored = await loadTokens(this.team);
        if (!stored?.refreshToken) {
            throw new Error(`[${this.team}] No refresh token available. Please re-authorize via the admin panel.`);
        }

        console.log(`[KommoService:${this.team}] Refreshing access token...`);
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

        const { access_token, refresh_token } = response.data;
        await saveTokens(this.team, { accessToken: access_token, refreshToken: refresh_token });
        this.setAccessToken(access_token);
        console.log(`[KommoService:${this.team}] Token refreshed and saved.`);
        return access_token;
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

        const { access_token, refresh_token } = response.data;
        await saveTokens(this.team, { accessToken: access_token, refreshToken: refresh_token });
        this.setAccessToken(access_token);
        console.log(`[KommoService:${this.team}] Authorization code exchanged, tokens saved.`);
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
                console.log(`[Kommo] Fetching leads page ${page}...`);
                const response = await this.client.get("/leads", {
                    params: {
                        limit: limit,
                        page: page,
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
}
