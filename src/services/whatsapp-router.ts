import { supabase } from "../api/supabase.js";
import { KommoService } from "./kommo.js";
import { getTeamConfigsFromTenant } from "../config.js";
import type { Tenant } from "../types/index.js";

const ROUTING_DELAY_MS = 5 * 60 * 1000; // 5 minutes — first attempt
const RETRY_DELAY_MS = 2 * 60 * 1000; // 2 minutes — between retries
const MAX_ATTEMPTS = 3;
const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SOURCE_PATTERN = /fonte|source|canal|origin|channel/i;

interface QueueItem {
  id: string;
  tenant_id: string;
  team: string;
  lead_id: number;
  pipeline_id: number | null;
  scheduled_at: string;
  result?: any;
}

export class WhatsAppRouter {
  private static recheckHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Start hourly recheck of failed/skipped items.
   */
  static startHourlyRecheck(): void {
    if (this.recheckHandle) return;
    console.log(`[WhatsAppRouter] Hourly recheck started — every ${RECHECK_INTERVAL_MS / 60000}min`);
    this.recheckHandle = setInterval(() => {
      this.recheckFailedItems().catch((err) =>
        console.error("[WhatsAppRouter] Hourly recheck error:", err.message)
      );
    }, RECHECK_INTERVAL_MS);
  }

  /**
   * Schedule routing for a new lead. Inserts into queue and sets setTimeout.
   */
  static async schedule(
    leadId: number,
    pipelineId: number | null,
    tenantId: string,
    team: string
  ): Promise<void> {
    const { count } = await supabase
      .from("whatsapp_numbers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("team", team)
      .eq("active", true);

    if (!count || count === 0) return;

    const scheduledAt = new Date(Date.now() + ROUTING_DELAY_MS).toISOString();

    const { data: item, error } = await supabase
      .from("whatsapp_routing_queue")
      .insert({
        tenant_id: tenantId,
        team,
        lead_id: leadId,
        pipeline_id: pipelineId,
        scheduled_at: scheduledAt,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[WhatsAppRouter] Failed to insert queue item:", error.message);
      return;
    }

    console.log(`[WhatsAppRouter] Scheduled routing for lead ${leadId} in 5 min (queue: ${item.id})`);

    setTimeout(() => {
      WhatsAppRouter.processQueueItem(item.id).catch((err) =>
        console.error(`[WhatsAppRouter] Timer error for ${item.id}:`, err.message)
      );
    }, ROUTING_DELAY_MS);
  }

  /**
   * Process a single queue item by ID.
   */
  static async processQueueItem(queueId: string): Promise<void> {
    const { data: item } = await supabase
      .from("whatsapp_routing_queue")
      .select("*")
      .eq("id", queueId)
      .in("status", ["pending", "retry"])
      .single();

    if (!item) return;

    const attempt = (item.result?.attempt || 0) + 1;

    try {
      const result = await WhatsAppRouter.processRouting(item as QueueItem, attempt);

      if (result === "no_match" && attempt < MAX_ATTEMPTS) {
        // Lead doesn't have source data yet — retry in 2min
        console.log(`[WhatsAppRouter] No match for lead ${item.lead_id}, retrying in 2min (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await supabase
          .from("whatsapp_routing_queue")
          .update({ status: "retry", result: { reason: "no_match", attempt } })
          .eq("id", queueId);

        setTimeout(() => {
          WhatsAppRouter.processQueueItem(queueId).catch((e) =>
            console.error(`[WhatsAppRouter] Retry error for ${queueId}:`, e.message)
          );
        }, RETRY_DELAY_MS);
        return;
      }

      // If still no_match after all attempts, mark as final skip
      if (result === "no_match") {
        await WhatsAppRouter.markProcessed(queueId, "skipped", {
          reason: "no_match",
          attempt,
          exhausted: true,
        });
      }
    } catch (err: any) {
      console.error(`[WhatsAppRouter] Error processing ${queueId}:`, err.message);

      if (attempt < MAX_ATTEMPTS) {
        console.log(`[WhatsAppRouter] Will retry ${queueId} (attempt ${attempt}/${MAX_ATTEMPTS})`);
        await supabase
          .from("whatsapp_routing_queue")
          .update({ status: "retry", result: { error: err.message, attempt } })
          .eq("id", queueId);

        setTimeout(() => {
          WhatsAppRouter.processQueueItem(queueId).catch((e) =>
            console.error(`[WhatsAppRouter] Retry error for ${queueId}:`, e.message)
          );
        }, RETRY_DELAY_MS);
      } else {
        await supabase
          .from("whatsapp_routing_queue")
          .update({
            status: "failed",
            result: { error: err.message, attempt, exhausted: true },
            processed_at: new Date().toISOString(),
          })
          .eq("id", queueId);
      }
    }
  }

  /**
   * Core routing logic. Returns "no_match" if source not found, undefined if processed/skipped.
   */
  static async processRouting(item: QueueItem, attempt: number): Promise<string | void> {
    const { tenant_id, team, lead_id } = item;

    const { data: tenant } = await supabase
      .from("tenants")
      .select("*")
      .eq("id", tenant_id)
      .single();

    if (!tenant) {
      await WhatsAppRouter.markProcessed(item.id, "skipped", { reason: "tenant_not_found" });
      return;
    }

    const teamConfigs = getTeamConfigsFromTenant(tenant as Tenant);
    const tc = teamConfigs[team];
    if (!tc?.subdomain) {
      await WhatsAppRouter.markProcessed(item.id, "skipped", { reason: "team_config_missing" });
      return;
    }

    const service = new KommoService(tc, team, tenant_id);

    let lead: any;
    try {
      lead = await service.getLeadDetails(lead_id);
    } catch (err: any) {
      // Lead fetch failed — throw so it gets retried
      throw new Error(`lead_fetch_failed: ${err.message}`);
    }

    const sourceName = WhatsAppRouter.extractSourceName(lead);

    const { data: numbers } = await supabase
      .from("whatsapp_numbers")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("team", team)
      .eq("active", true);

    if (!numbers || numbers.length === 0) {
      await WhatsAppRouter.markProcessed(item.id, "skipped", { reason: "no_numbers_registered" });
      return;
    }

    // Match by source name
    let matchedNumber = sourceName
      ? numbers.find((n: any) => n.kommo_source_name && sourceName.toLowerCase().includes(n.kommo_source_name.toLowerCase()))
      : null;

    // Fallback: match by phone
    if (!matchedNumber) {
      const contactPhone = WhatsAppRouter.extractContactPhone(lead);
      if (contactPhone) {
        const normalizedPhone = WhatsAppRouter.normalizePhone(contactPhone);
        matchedNumber = numbers.find((n: any) => WhatsAppRouter.normalizePhone(n.phone) === normalizedPhone);
      }
    }

    if (!matchedNumber) {
      // Return "no_match" so caller can decide to retry
      return "no_match";
    }

    const targetKommoUserId = matchedNumber.kommo_user_id;
    if (!targetKommoUserId) {
      await WhatsAppRouter.markProcessed(item.id, "skipped", { reason: "no_kommo_user_id" });
      return;
    }

    if (lead.responsible_user_id === targetKommoUserId) {
      await WhatsAppRouter.markProcessed(item.id, "skipped", { reason: "already_assigned" });
      return;
    }

    // === ROUTE THE LEAD ===
    const fromUserId = lead.responsible_user_id;
    await service.updateLeadResponsible(lead_id, targetKommoUserId);

    const contacts = lead._embedded?.contacts || [];
    for (const contact of contacts) {
      try {
        await service.updateContactResponsible(contact.id, targetKommoUserId);
      } catch (err: any) {
        console.warn(`[WhatsAppRouter] Failed to update contact ${contact.id}:`, err.message);
      }
    }

    const companies = lead._embedded?.companies || [];
    for (const company of companies) {
      try {
        await service.updateCompanyResponsible(company.id, targetKommoUserId);
      } catch (err: any) {
        console.warn(`[WhatsAppRouter] Failed to update company ${company.id}:`, err.message);
      }
    }

    // Add note to the lead conversation in Kommo
    try {
      await service.addNote(
        lead_id,
        `SuperGerente roteou este lead do agente #${fromUserId} para o agente #${targetKommoUserId} (fonte: ${sourceName || matchedNumber.kommo_source_name || matchedNumber.phone})`
      );
    } catch (err: any) {
      console.warn(`[WhatsAppRouter] Failed to add note to lead ${lead_id}:`, err.message);
    }

    await supabase.from("whatsapp_routing_logs").insert({
      tenant_id,
      team,
      lead_id,
      lead_name: lead.name || `Lead ${lead_id}`,
      from_user_id: fromUserId,
      to_user_id: targetKommoUserId,
      to_user_name: matchedNumber.kommo_source_name || matchedNumber.phone,
      phone_matched: matchedNumber.phone,
      source_name: sourceName || "unknown",
    });

    console.log(`[WhatsAppRouter] Routed lead ${lead_id}: user ${fromUserId} -> ${targetKommoUserId} (phone: ${matchedNumber.phone})`);

    await WhatsAppRouter.markProcessed(item.id, "processed", {
      from: fromUserId,
      to: targetKommoUserId,
      phone: matchedNumber.phone,
      attempt,
    });
  }

  /**
   * Hourly recheck: re-process items that failed or had no_match in the last 48h.
   */
  static async recheckFailedItems(): Promise<{ retried: number; processed: number; errors: number }> {
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    const { data: items } = await supabase
      .from("whatsapp_routing_queue")
      .select("id, lead_id, result")
      .in("status", ["failed", "skipped"])
      .gte("scheduled_at", since)
      .order("scheduled_at", { ascending: true })
      .limit(100);

    if (!items || items.length === 0) {
      console.log("[WhatsAppRouter] Recheck: nothing to retry");
      return { retried: 0, processed: 0, errors: 0 };
    }

    // Only retry items that failed or skipped with retryable reasons
    const retryable = items.filter((i) => {
      const reason = i.result?.reason;
      const status = i.result?.exhausted ? false : true;
      return (
        reason === "no_match" ||
        reason === "lead_fetch_failed" ||
        i.result?.error // API errors
      ) && status;
    });

    console.log(`[WhatsAppRouter] Recheck: ${retryable.length} retryable items from last 48h`);

    let processed = 0;
    let errors = 0;

    for (const item of retryable) {
      try {
        // Reset to pending so processQueueItem picks it up
        await supabase
          .from("whatsapp_routing_queue")
          .update({ status: "pending", result: { ...item.result, recheck: true } })
          .eq("id", item.id);

        await WhatsAppRouter.processQueueItem(item.id);
        processed++;
      } catch (err: any) {
        errors++;
        console.error(`[WhatsAppRouter] Recheck error for ${item.id}:`, err.message);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`[WhatsAppRouter] Recheck complete: ${retryable.length} retried, ${processed} processed, ${errors} errors`);
    return { retried: retryable.length, processed, errors };
  }

  /**
   * Full sweep: re-process ALL failed/skipped/no_match items from the last N hours.
   * Forces retry even on exhausted items.
   */
  static async sweepAll(
    tenantId: string | null,
    hoursBack: number = 48
  ): Promise<{ retried: number; processed: number; skipped: number; errors: number }> {
    const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

    let query = supabase
      .from("whatsapp_routing_queue")
      .select("id, lead_id, status, result")
      .in("status", ["failed", "skipped"])
      .gte("scheduled_at", since)
      .order("scheduled_at", { ascending: true })
      .limit(200);

    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { data: items } = await query;

    if (!items || items.length === 0) {
      console.log("[WhatsAppRouter] Sweep: nothing to retry");
      return { retried: 0, processed: 0, skipped: 0, errors: 0 };
    }

    // Filter to only retryable reasons (exclude "already_assigned", "no_kommo_user_id", etc.)
    const retryable = items.filter((i) => {
      const reason = i.result?.reason;
      return (
        !reason || // errors without reason
        reason === "no_match" ||
        reason === "lead_fetch_failed"
      );
    });

    const skipped = items.length - retryable.length;

    console.log(`[WhatsAppRouter] Sweep: ${retryable.length} items to retry, ${skipped} permanently skipped (last ${hoursBack}h)`);

    let processed = 0;
    let errors = 0;

    for (const item of retryable) {
      try {
        await supabase
          .from("whatsapp_routing_queue")
          .update({ status: "pending", result: { ...item.result, sweep: true, attempt: 0 } })
          .eq("id", item.id);

        await WhatsAppRouter.processQueueItem(item.id);
        processed++;
      } catch (err: any) {
        errors++;
        console.error(`[WhatsAppRouter] Sweep error for ${item.id}:`, err.message);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[WhatsAppRouter] Sweep complete: ${retryable.length} retried, ${processed} processed, ${errors} errors`);
    return { retried: retryable.length, processed, skipped, errors };
  }

  /**
   * Catch-up: process pending queue items that survived a restart.
   */
  static async processPendingQueue(): Promise<void> {
    const { data: pending } = await supabase
      .from("whatsapp_routing_queue")
      .select("id, scheduled_at")
      .in("status", ["pending", "retry"])
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(50);

    if (!pending || pending.length === 0) return;

    console.log(`[WhatsAppRouter] Catch-up: ${pending.length} pending items found`);

    for (const item of pending) {
      await WhatsAppRouter.processQueueItem(item.id);
    }
  }

  private static extractSourceName(lead: any): string | null {
    const cfValues = lead.custom_fields_values;
    if (!cfValues || !Array.isArray(cfValues)) return null;

    for (const cf of cfValues) {
      if (SOURCE_PATTERN.test(cf.field_name || "")) {
        return cf.values?.[0]?.value?.toString() || null;
      }
    }
    return null;
  }

  private static extractContactPhone(lead: any): string | null {
    const contacts = lead._embedded?.contacts || [];
    for (const contact of contacts) {
      const cfs = contact.custom_fields_values || [];
      for (const cf of cfs) {
        if (cf.field_code === "PHONE" || /phone|telefone|celular/i.test(cf.field_name || "")) {
          return cf.values?.[0]?.value?.toString() || null;
        }
      }
    }
    return null;
  }

  private static normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "").replace(/^0+/, "");
  }

  private static async markProcessed(
    queueId: string,
    status: string,
    result: Record<string, any>
  ): Promise<void> {
    await supabase
      .from("whatsapp_routing_queue")
      .update({ status, result, processed_at: new Date().toISOString() })
      .eq("id", queueId);
  }
}
