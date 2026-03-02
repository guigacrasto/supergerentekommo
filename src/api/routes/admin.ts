import { Router } from "express";
import { supabase } from "../supabase.js";
import { requireAdmin, AuthRequest } from "../middleware/requireAuth.js";
import { TEAMS, TeamKey } from "../../config.js";
import { KommoService } from "../../services/kommo.js";

export function adminRouter(services: Record<TeamKey, KommoService>): Router {
  const router = Router();
  router.use(requireAdmin as any);

  // GET /api/admin/users
  router.get("/users", async (_req, res) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, status, role, teams, created_at")
      .eq("role", "user")
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  });

  // POST /api/admin/users/:id/approve
  router.post("/users/:id/approve", async (req, res) => {
    const { teams } = req.body; // e.g. ["azul"] or ["azul","amarela"]
    const updateData: any = { status: "approved" };
    if (Array.isArray(teams) && teams.length > 0) {
      updateData.teams = teams;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", req.params.id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Usuário aprovado." });
  });

  // POST /api/admin/users/:id/deny
  router.post("/users/:id/deny", async (req, res) => {
    const { error } = await supabase
      .from("profiles")
      .update({ status: "denied" })
      .eq("id", req.params.id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Usuário negado." });
  });

  // GET /api/admin/tokens
  router.get("/tokens", async (_req, res) => {
    const { data, error } = await supabase
      .from("token_logs")
      .select(`user_id, total_tokens, prompt_tokens, completion_tokens, created_at, profiles!inner(name, email)`)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const byUser: Record<string, any> = {};
    for (const row of data || []) {
      const uid = row.user_id;
      if (!byUser[uid]) {
        byUser[uid] = {
          userId: uid,
          name: (row.profiles as any).name,
          email: (row.profiles as any).email,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          messages: 0,
          estimatedCostUSD: 0,
        };
      }
      byUser[uid].totalTokens += row.total_tokens;
      byUser[uid].promptTokens += row.prompt_tokens;
      byUser[uid].completionTokens += row.completion_tokens;
      byUser[uid].messages += 1;
      byUser[uid].estimatedCostUSD +=
        (row.prompt_tokens * 0.075 + row.completion_tokens * 0.30) / 1_000_000;
    }

    const result = Object.values(byUser)
      .sort((a: any, b: any) => b.totalTokens - a.totalTokens)
      .map((u: any) => ({ ...u, estimatedCostUSD: `$${u.estimatedCostUSD.toFixed(4)}` }));

    res.json(result);
  });

  // GET /api/admin/mentors
  router.get("/mentors", async (_req, res) => {
    const { data, error } = await supabase
      .from("mentors")
      .select("id, name, description, system_prompt, methodology_text, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // POST /api/admin/mentors
  router.post("/mentors", async (req, res) => {
    const { name, description, system_prompt, methodology_text, is_active } = req.body;
    if (!name || !system_prompt) return res.status(400).json({ error: "name e system_prompt são obrigatórios" });
    const { data, error } = await supabase
      .from("mentors")
      .insert({ name, description, system_prompt, methodology_text, is_active: is_active ?? true })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // PUT /api/admin/mentors/:id
  router.put("/mentors/:id", async (req, res) => {
    const { id } = req.params;
    const { name, description, system_prompt, methodology_text, is_active } = req.body;
    const { data, error } = await supabase
      .from("mentors")
      .update({ name, description, system_prompt, methodology_text, is_active })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  // DELETE /api/admin/mentors/:id
  router.delete("/mentors/:id", async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from("mentors").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // GET /api/admin/pipeline-visibility
  router.get("/pipeline-visibility", async (_req, res) => {
    try {
      const allPipelines: Array<{
        pipeline_id: number;
        pipeline_name: string;
        team: string;
        visible: boolean;
      }> = [];

      // Fetch pipelines from Kommo API for each configured team
      const teamKeys = (Object.keys(TEAMS) as TeamKey[]).filter(
        (k) => TEAMS[k].subdomain && services[k]
      );

      const teamResults = await Promise.all(
        teamKeys.map(async (team) => {
          try {
            const excludeNames = TEAMS[team].excludePipelineNames;
            const pipelines = await services[team].getPipelines();
            return pipelines
              .filter((p: any) =>
                !excludeNames.some((ex) =>
                  p.name.toUpperCase().includes(ex.toUpperCase())
                )
              )
              .map((p: any) => ({
                pipeline_id: p.id as number,
                pipeline_name: p.name as string,
                team,
              }));
          } catch (err: any) {
            console.error(`[Admin] Erro pipelines ${team}:`, err.message);
            return [];
          }
        })
      );

      const apiPipelines = teamResults.flat();

      // Fetch visibility overrides from Supabase
      const { data: overrides } = await supabase
        .from("pipeline_visibility")
        .select("team, pipeline_id, visible");

      const overrideMap = new Map<string, boolean>();
      for (const o of overrides || []) {
        overrideMap.set(`${o.team}:${o.pipeline_id}`, o.visible);
      }

      // Merge: default visible=true if no override
      for (const p of apiPipelines) {
        const key = `${p.team}:${p.pipeline_id}`;
        allPipelines.push({
          ...p,
          visible: overrideMap.has(key) ? overrideMap.get(key)! : true,
        });
      }

      res.json(allPipelines);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Admin] Pipeline visibility error:", error);
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/admin/pipeline-visibility
  router.put("/pipeline-visibility", async (req, res) => {
    const { team, pipeline_id, pipeline_name, visible } = req.body;

    if (!team || !pipeline_id || typeof visible !== "boolean") {
      res.status(400).json({ error: "team, pipeline_id e visible sao obrigatorios" });
      return;
    }

    try {
      const { error } = await supabase
        .from("pipeline_visibility")
        .upsert(
          {
            team,
            pipeline_id,
            pipeline_name: pipeline_name || "",
            visible,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "team,pipeline_id" }
        );

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
