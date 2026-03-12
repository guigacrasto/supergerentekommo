import { Router } from "express";
import { getCrmMetrics, invalidateAllCaches } from "../cache/crm-cache.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";
import { getVapidPublicKey } from "../services/push.js";
import { getTeamConfigsFromTenant } from "../../config.js";
import { KommoService } from "../../services/kommo.js";

function isAdmin(req: AuthRequest): boolean {
  return req.userRole === "admin" || req.userRole === "superadmin";
}

export function adminRouter() {
  const router = Router();
  router.use(requireAuth as any);

  // POST /api/admin/cache-refresh — force refresh all CRM caches
  router.post("/cache-refresh", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }
    invalidateAllCaches();
    res.json({ ok: true, message: "Cache invalidado. Proximo request vai buscar dados frescos." });
  });

  // ──────────────────────────────────────────────
  // F02 — Pipelines Pausadas
  // ──────────────────────────────────────────────

  router.get("/pipelines", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    try {
      const allPipelines: Array<{ id: number; name: string; team: string }> = [];
      const teamConfigs = getTeamConfigsFromTenant(req.tenant);

      await Promise.all(
        Object.entries(teamConfigs).map(async ([team, cfg]) => {
          try {
            const service = new KommoService(cfg, team);
            const metrics = await getCrmMetrics(team, service, undefined, cfg.excludePipelineNames);
            for (const [idStr, name] of Object.entries(metrics.pipelineNames)) {
              allPipelines.push({ id: Number(idStr), name, team });
            }
          } catch (err: any) {
            console.error(`[Admin] Erro ao buscar pipelines da equipe ${team}:`, err.message);
          }
        })
      );

      let pausedIds: number[] = [];
      const { data: setting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "paused_pipelines")
        .single();

      if (setting?.value) {
        try {
          pausedIds = Array.isArray(setting.value) ? setting.value : JSON.parse(setting.value);
        } catch {
          pausedIds = [];
        }
      }

      const pausedSet = new Set(pausedIds);

      const result = allPipelines.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        paused: pausedSet.has(p.id),
      }));

      res.json(result);
    } catch (error: any) {
      console.error("[Admin] Erro ao listar pipelines:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/pipelines/pause", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const { pipelineId, paused } = req.body;

    if (typeof pipelineId !== "number" || typeof paused !== "boolean") {
      res.status(400).json({ error: "Body deve conter pipelineId (number) e paused (boolean)." });
      return;
    }

    try {
      let pausedIds: number[] = [];
      const { data: setting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "paused_pipelines")
        .single();

      if (setting?.value) {
        try {
          pausedIds = Array.isArray(setting.value) ? setting.value : JSON.parse(setting.value);
        } catch {
          pausedIds = [];
        }
      }

      if (paused) {
        if (!pausedIds.includes(pipelineId)) {
          pausedIds.push(pipelineId);
        }
      } else {
        pausedIds = pausedIds.filter((id) => id !== pipelineId);
      }

      const { error } = await supabase
        .from("settings")
        .upsert(
          { key: "paused_pipelines", value: pausedIds },
          { onConflict: "key" }
        );

      if (error) {
        console.error("[Admin] Erro ao salvar paused_pipelines:", error.message);
        res.status(500).json({ error: error.message });
        return;
      }

      console.log(`[Admin] Pipeline ${pipelineId} ${paused ? "pausado" : "reativado"}`);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[Admin] Erro ao pausar/reativar pipeline:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // F08 — Gestao de Funis por Usuario
  // ──────────────────────────────────────────────

  router.get("/groups", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    try {
      const teamConfigs = getTeamConfigsFromTenant(req.tenant);

      const gruposByTeam: Record<string, string[]> = {};
      await Promise.all(
        Object.entries(teamConfigs).map(async ([team, cfg]) => {
          try {
            const service = new KommoService(cfg, team);
            const metrics = await getCrmMetrics(team, service, undefined, cfg.excludePipelineNames);
            const gruposSet = new Set(Object.values(metrics.userGroups));
            gruposByTeam[team] = Array.from(gruposSet).sort();
          } catch (err: any) {
            console.error(`[Admin] Erro ao buscar grupos da equipe ${team}:`, err.message);
            gruposByTeam[team] = [];
          }
        })
      );

      res.json(gruposByTeam);
    } catch (error: any) {
      console.error("[Admin] Erro ao listar grupos:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/users", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    try {
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, email, name, role, status, teams, can_view_ranking");

      if (profilesError) {
        res.status(500).json({ error: profilesError.message });
        return;
      }

      let permissionsMap: Record<string, Record<string, number[]>> = {};
      try {
        const { data: permissions, error: permError } = await supabase
          .from("user_funnel_permissions")
          .select("user_id, team, allowed_funnels");

        if (!permError && permissions) {
          for (const perm of permissions) {
            if (!permissionsMap[perm.user_id]) {
              permissionsMap[perm.user_id] = {};
            }
            permissionsMap[perm.user_id][perm.team] = perm.allowed_funnels || [];
          }
        }
      } catch {
        console.warn("[Admin] Tabela user_funnel_permissions nao encontrada.");
      }

      const groupPermMap: Record<string, Record<string, string[]>> = {};
      try {
        const { data: groupSettings } = await supabase
          .from("settings")
          .select("key, value")
          .like("key", "user_groups:%");

        if (groupSettings) {
          for (const s of groupSettings) {
            const userId = s.key.replace("user_groups:", "");
            const val = typeof s.value === "string" ? JSON.parse(s.value) : s.value;
            groupPermMap[userId] = val || {};
          }
        }
      } catch {
        console.warn("[Admin] Erro ao buscar permissoes de grupo.");
      }

      const result = (profiles || []).map((p) => ({
        id: p.id,
        email: p.email,
        name: p.name,
        role: p.role,
        status: p.status,
        teams: p.teams,
        allowed_funnels: permissionsMap[p.id] || {},
        allowed_groups: groupPermMap[p.id] || {},
        can_view_ranking: p.can_view_ranking ?? false,
      }));

      res.json(result);
    } catch (error: any) {
      console.error("[Admin] Erro ao listar usuarios:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/users/:id/approve", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const userId = req.params.id;
    const { status } = req.body;

    if (!["approved", "denied"].includes(status)) {
      res.status(400).json({ error: "Status deve ser 'approved' ou 'denied'." });
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/users/:id/role", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const userId = req.params.id;
    const { role } = req.body;

    if (!["user", "admin", "superadmin"].includes(role)) {
      res.status(400).json({ error: "Role deve ser 'user', 'admin' ou 'superadmin'." });
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/users/:id/funnels", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const userId = req.params.id;
    const { team, allowed_funnels } = req.body;

    if (!team || !Array.isArray(allowed_funnels)) {
      res.status(400).json({ error: "Body deve conter team (string) e allowed_funnels (number[])." });
      return;
    }

    try {
      const { error } = await supabase
        .from("user_funnel_permissions")
        .upsert(
          {
            user_id: userId,
            team,
            allowed_funnels,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,team" }
        );

      if (error) {
        console.error("[Admin] Erro ao atualizar permissoes de funil:", error.message);
        res.status(500).json({ error: error.message });
        return;
      }

      console.log(`[Admin] Funis do usuario ${userId} (equipe ${team}) atualizados: [${allowed_funnels.join(", ")}]`);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[Admin] Erro ao atualizar funis do usuario:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/users/:id/groups", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const userId = req.params.id;
    const { team, allowed_groups } = req.body;

    if (!team || !Array.isArray(allowed_groups)) {
      res.status(400).json({ error: "Body deve conter team (string) e allowed_groups (string[])." });
      return;
    }

    try {
      const settingsKey = `user_groups:${userId}`;
      const { data: existing } = await supabase
        .from("settings")
        .select("value")
        .eq("key", settingsKey)
        .single();

      let current: Record<string, string[]> = {};
      if (existing?.value) {
        current = typeof existing.value === "string" ? JSON.parse(existing.value) : existing.value;
      }

      current[team] = allowed_groups;

      const { error } = await supabase
        .from("settings")
        .upsert(
          { key: settingsKey, value: current, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );

      if (error) {
        console.error("[Admin] Erro ao salvar permissoes de grupo:", error.message);
        res.status(500).json({ error: error.message });
        return;
      }

      console.log(`[Admin] Grupos do usuario ${userId} (equipe ${team}) atualizados: [${allowed_groups.join(", ")}]`);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[Admin] Erro ao atualizar grupos do usuario:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/users/:id/teams", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const userId = req.params.id;
    const { teams } = req.body;

    if (!Array.isArray(teams)) {
      res.status(400).json({ error: "Body deve conter teams (string[])." });
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ teams })
        .eq("id", userId);

      if (error) {
        console.error("[Admin] Erro ao atualizar equipes:", error.message);
        res.status(500).json({ error: error.message });
        return;
      }

      console.log(`[Admin] Equipes do usuario ${userId} atualizadas: [${teams.join(", ")}]`);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[Admin] Erro ao atualizar equipes:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // Audit Logs
  // ──────────────────────────────────────────────

  router.get("/audit-logs", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;

      let query = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (req.query.userId) {
        query = query.eq("user_id", req.query.userId);
      }
      if (req.query.action) {
        query = query.eq("action", req.query.action);
      }
      if (req.query.from) {
        query = query.gte("created_at", req.query.from);
      }
      if (req.query.to) {
        query = query.lte("created_at", req.query.to);
      }

      const { data, count, error } = await query;

      if (error) {
        // Table may not exist yet
        if (error.code === '42P01') {
          res.json({ logs: [], total: 0, page, limit });
          return;
        }
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ logs: data || [], total: count || 0, page, limit });
    } catch (error: any) {
      console.error("[Admin] Erro ao buscar audit logs:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // Webhook Config (Hot Lead Statuses)
  // ──────────────────────────────────────────────

  router.get("/webhook-config", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    try {
      const { data } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "hot_lead_statuses")
        .single();

      const hotStatuses: number[] = data?.value
        ? (Array.isArray(data.value) ? data.value : JSON.parse(data.value))
        : [];

      res.json({ hotStatuses, vapidPublicKey: getVapidPublicKey() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/webhook-config", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const { hotStatuses } = req.body;
    if (!Array.isArray(hotStatuses)) {
      res.status(400).json({ error: "hotStatuses deve ser um array de números." });
      return;
    }

    try {
      const { error } = await supabase
        .from("settings")
        .upsert(
          { key: "hot_lead_statuses", value: hotStatuses },
          { onConflict: "key" }
        );

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // Kommo Re-Authorization (1-click token renewal)
  // ──────────────────────────────────────────────

  router.get("/kommo-auth-url", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const team = (req.query.team as string) || "azul";

    try {
      const teamConfigs = getTeamConfigsFromTenant(req.tenant);
      const cfg = teamConfigs[team];

      if (!cfg || !cfg.subdomain || !cfg.clientId) {
        res.status(404).json({ error: `Configuracao do time '${team}' nao encontrada.` });
        return;
      }

      const authUrl = `https://${cfg.subdomain}.kommo.com/oauth?client_id=${cfg.clientId}&mode=popup`;
      res.json({ authUrl, team });
    } catch (error: any) {
      console.error("[Admin] Erro ao gerar URL de auth Kommo:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/kommo-auth-code", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const { team, code } = req.body;

    if (!team || !code) {
      res.status(400).json({ error: "Body deve conter team (string) e code (string)." });
      return;
    }

    try {
      const teamConfigs = getTeamConfigsFromTenant(req.tenant);
      const cfg = teamConfigs[team];

      if (!cfg || !cfg.subdomain) {
        res.status(404).json({ error: `Configuracao do time '${team}' nao encontrada.` });
        return;
      }

      const service = new KommoService(cfg, team);
      await service.exchangeAuthCode(code);

      console.log(`[Admin] Token Kommo do time ${team} re-autorizado com sucesso`);
      res.json({ ok: true, message: `Token do time ${team} renovado com sucesso.` });
    } catch (error: any) {
      console.error("[Admin] Erro ao trocar auth code Kommo:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ──────────────────────────────────────────────
  // Ranking Permission Toggle
  // ──────────────────────────────────────────────

  router.patch("/users/:id/ranking-permission", async (req: AuthRequest, res) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const userId = req.params.id;
    const { can_view_ranking } = req.body;

    if (typeof can_view_ranking !== "boolean") {
      res.status(400).json({ error: "Body deve conter can_view_ranking (boolean)." });
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ can_view_ranking, updated_at: new Date().toISOString() })
        .eq("id", userId);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      console.log(`[Admin] Ranking permission do usuario ${userId}: ${can_view_ranking}`);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
