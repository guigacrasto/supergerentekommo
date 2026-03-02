import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";

export function pipelinesRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/pipelines — pipelines from all authorized teams
  router.get("/", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    try {
      const results: Array<{ id: number; name: string; team: TeamKey }> = [];

      const teamResults = await Promise.all(
        userTeams
          .filter((t) => services[t] && TEAMS[t].subdomain)
          .map(async (team) => {
            try {
              const excludeNames = TEAMS[team].excludePipelineNames;
              const pipelines = await services[team].getPipelines();
              return pipelines
                .filter((p: any) => !excludeNames.some((ex) => p.name.toUpperCase().includes(ex.toUpperCase())))
                .map((p: any) => ({ id: p.id, name: p.name, team }));
            } catch (teamErr: any) {
              console.error(`[/api/pipelines] Erro ao buscar pipelines da equipe ${team}:`, teamErr.message);
              return [];
            }
          })
      );
      results.push(...teamResults.flat());

      // Filter by pipeline_visibility (admin bypasses)
      if (req.userRole !== "admin") {
        const { data: overrides } = await supabase
          .from("pipeline_visibility")
          .select("team, pipeline_id, visible")
          .eq("visible", false);

        if (overrides && overrides.length > 0) {
          const hiddenSet = new Set(
            overrides.map((o: any) => `${o.team}:${o.pipeline_id}`)
          );
          const filtered = results.filter(
            (p: any) => !hiddenSet.has(`${p.team}:${p.id}`)
          );
          results.length = 0;
          results.push(...filtered);
        }
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
