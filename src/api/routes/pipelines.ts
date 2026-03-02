import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

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

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
