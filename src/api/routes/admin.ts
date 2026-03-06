import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { getCrmMetrics } from "../cache/crm-cache.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";

export function adminRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // ──────────────────────────────────────────────
  // F02 — Pipelines Pausadas
  // ──────────────────────────────────────────────

  // GET /api/admin/pipelines — Lista todos os pipelines com status de pausa
  router.get("/pipelines", async (req: AuthRequest, res) => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    try {
      // Buscar pipelines de todas as equipes configuradas via cache
      const allPipelines: Array<{ id: number; name: string; team: TeamKey }> = [];

      const configuredTeams = (Object.keys(TEAMS) as TeamKey[]).filter(
        (k) => TEAMS[k].subdomain && services[k]
      );

      await Promise.all(
        configuredTeams.map(async (team) => {
          try {
            const metrics = await getCrmMetrics(team, services[team]);
            for (const [idStr, name] of Object.entries(metrics.pipelineNames)) {
              allPipelines.push({ id: Number(idStr), name, team });
            }
          } catch (err: any) {
            console.error(`[Admin] Erro ao buscar pipelines da equipe ${team}:`, err.message);
          }
        })
      );

      // Buscar lista de pipelines pausados no Supabase settings
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

  // POST /api/admin/pipelines/pause — Alterna status de pausa de um pipeline
  router.post("/pipelines/pause", async (req: AuthRequest, res) => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const { pipelineId, paused } = req.body;

    if (typeof pipelineId !== "number" || typeof paused !== "boolean") {
      res.status(400).json({ error: "Body deve conter pipelineId (number) e paused (boolean)." });
      return;
    }

    try {
      // Ler lista atual de pipelines pausados
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

      // Adicionar ou remover o pipeline
      if (paused) {
        if (!pausedIds.includes(pipelineId)) {
          pausedIds.push(pipelineId);
        }
      } else {
        pausedIds = pausedIds.filter((id) => id !== pipelineId);
      }

      // Salvar de volta no Supabase settings (upsert)
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

  // GET /api/admin/users — Lista usuarios com permissoes de funil
  router.get("/users", async (req: AuthRequest, res) => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    try {
      // Buscar perfis
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, email, name, role, status, teams");

      if (profilesError) {
        res.status(500).json({ error: profilesError.message });
        return;
      }

      // Buscar permissoes de funil (tabela pode nao existir ainda)
      let permissionsMap: Record<string, number[]> = {};
      try {
        const { data: permissions, error: permError } = await supabase
          .from("user_funnel_permissions")
          .select("user_id, allowed_funnels");

        if (!permError && permissions) {
          for (const perm of permissions) {
            permissionsMap[perm.user_id] = perm.allowed_funnels || [];
          }
        }
      } catch {
        // Tabela pode nao existir ainda — retornar vazio
        console.warn("[Admin] Tabela user_funnel_permissions nao encontrada, retornando vazio.");
      }

      const result = (profiles || []).map((p) => ({
        id: p.id,
        email: p.email,
        name: p.name,
        role: p.role,
        status: p.status,
        teams: p.teams,
        allowed_funnels: permissionsMap[p.id] || [],
      }));

      res.json(result);
    } catch (error: any) {
      console.error("[Admin] Erro ao listar usuarios:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/admin/users/:id/funnels — Atualiza funis permitidos de um usuario
  router.patch("/users/:id/funnels", async (req: AuthRequest, res) => {
    if (req.userRole !== "admin") {
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
      // Upsert na tabela user_funnel_permissions
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

      // NOTA: O cache de auth e in-memory (authCache no requireAuth.ts).
      // Idealmente limpariamos a entrada do usuario aqui, mas o cache
      // expira em 5 minutos automaticamente. Para efeito imediato,
      // o usuario precisaria fazer logout/login.

      console.log(`[Admin] Funis do usuario ${userId} (equipe ${team}) atualizados: [${allowed_funnels.join(", ")}]`);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[Admin] Erro ao atualizar funis do usuario:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/admin/users/:id/teams — Atualiza equipes de um usuario
  router.patch("/users/:id/teams", async (req: AuthRequest, res) => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }

    const userId = req.params.id;
    const { teams } = req.body;

    if (!Array.isArray(teams)) {
      res.status(400).json({ error: "Body deve conter teams (string[])." });
      return;
    }

    // Validate team values
    const validTeams = (Object.keys(TEAMS) as TeamKey[]).filter((k) => TEAMS[k].subdomain);
    const filtered = teams.filter((t: string) => validTeams.includes(t as TeamKey));

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ teams: filtered })
        .eq("id", userId);

      if (error) {
        console.error("[Admin] Erro ao atualizar equipes:", error.message);
        res.status(500).json({ error: error.message });
        return;
      }

      console.log(`[Admin] Equipes do usuario ${userId} atualizadas: [${filtered.join(", ")}]`);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("[Admin] Erro ao atualizar equipes:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
