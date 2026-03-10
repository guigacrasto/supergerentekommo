import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { getTeamConfigsFromTenant } from "../../config.js";
import { AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";

export function pipelinesRouter() {
  const router = Router();

  // GET /api/pipelines — pipelines from all authorized teams
  router.get("/", async (req, res) => {
    const authReq = req as AuthRequest;
    const userTeams = authReq.userTeams || [];
    const teamConfigs = getTeamConfigsFromTenant(authReq.tenant);

    try {
      const results: Array<{ id: number; name: string; team: string }> = [];

      const teamResults = await Promise.all(
        userTeams
          .filter((t) => !!teamConfigs[t] && teamConfigs[t].subdomain)
          .map(async (team) => {
            try {
              const cfg = teamConfigs[team];
              const kommoService = new KommoService(cfg, team);
              const excludeNames = cfg.excludePipelineNames;
              const pipelines = await kommoService.getPipelines();
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
      if (authReq.userRole !== "admin") {
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
