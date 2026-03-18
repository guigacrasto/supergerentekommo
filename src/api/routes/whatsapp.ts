import { Router } from "express";
import { supabase } from "../supabase.js";
import { getTeamConfigsFromTenant } from "../../config.js";
import { KommoService } from "../../services/kommo.js";
import type { Tenant } from "../../types/index.js";

export function whatsappRouter() {
  const router = Router();

  // GET /api/whatsapp/numbers — List registered numbers
  router.get("/numbers", async (req: any, res) => {
    try {
      const tenantId = req.tenantId;

      const { data, error } = await supabase
        .from("whatsapp_numbers")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      res.json({ numbers: data || [] });
    } catch (err: any) {
      console.error("[WhatsApp] GET /numbers error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/whatsapp/numbers — Register a number
  router.post("/numbers", async (req: any, res) => {
    try {
      const { phone, kommo_source_name, kommo_user_id, team } = req.body;

      if (!phone) {
        return res.status(400).json({ error: "phone is required" });
      }

      const { data, error } = await supabase
        .from("whatsapp_numbers")
        .upsert(
          {
            tenant_id: req.tenantId,
            user_id: req.userId,
            team: team || "azul",
            phone: phone.replace(/\D/g, ""),
            kommo_source_name: kommo_source_name || null,
            kommo_user_id: kommo_user_id || null,
            active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,phone" }
        )
        .select()
        .single();

      if (error) throw error;

      res.json({ number: data });
    } catch (err: any) {
      console.error("[WhatsApp] POST /numbers error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/whatsapp/numbers/:id — Update a number (agent, source, active)
  router.patch("/numbers/:id", async (req: any, res) => {
    try {
      const { id } = req.params;
      const { kommo_source_name, kommo_user_id, active } = req.body;

      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (kommo_source_name !== undefined) updates.kommo_source_name = kommo_source_name || null;
      if (kommo_user_id !== undefined) updates.kommo_user_id = kommo_user_id || null;
      if (active !== undefined) updates.active = active;

      let query = supabase
        .from("whatsapp_numbers")
        .update(updates)
        .eq("id", id)
        .eq("tenant_id", req.tenantId);

      if (req.userRole !== "admin" && req.userRole !== "superadmin") {
        query = query.eq("user_id", req.userId);
      }

      const { data, error } = await query.select().single();
      if (error) throw error;

      res.json({ number: data });
    } catch (err: any) {
      console.error("[WhatsApp] PATCH /numbers/:id error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/whatsapp/numbers/:id — Remove a number
  router.delete("/numbers/:id", async (req: any, res) => {
    try {
      const { id } = req.params;

      let query = supabase
        .from("whatsapp_numbers")
        .delete()
        .eq("id", id)
        .eq("tenant_id", req.tenantId);

      if (req.userRole !== "admin" && req.userRole !== "superadmin") {
        query = query.eq("user_id", req.userId);
      }

      const { error } = await query;
      if (error) throw error;

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[WhatsApp] DELETE /numbers/:id error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/whatsapp/kommo-users — List Kommo users (agents) for dropdown
  router.get("/kommo-users", async (req: any, res) => {
    try {
      const team = (req.query.team as string) || "azul";
      const teamConfigs = getTeamConfigsFromTenant(req.tenant as Tenant);
      const tc = teamConfigs[team];

      if (!tc?.subdomain) {
        return res.json({ users: [] });
      }

      const service = new KommoService(tc, team, req.tenantId);
      const users = await service.getUsers();

      const mapped = users.map((u: any) => ({
        id: u.id,
        name: u.name || u.email || `User ${u.id}`,
        email: u.email || "",
      }));

      res.json({ users: mapped });
    } catch (err: any) {
      console.error("[WhatsApp] GET /kommo-users error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/whatsapp/logs — List routing logs
  router.get("/logs", async (req: any, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);

      const { data, error } = await supabase
        .from("whatsapp_routing_logs")
        .select("*")
        .eq("tenant_id", req.tenantId)
        .order("routed_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      res.json({ logs: data || [] });
    } catch (err: any) {
      console.error("[WhatsApp] GET /logs error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
