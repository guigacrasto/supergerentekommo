import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

function formatDateOnly(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateTimeGMT3(date: Date): string {
  const gmt3Time = date.getTime() + -3 * 60 * 60 * 1000;
  const d = new Date(gmt3Time);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min} (GMT-3)`;
}

export function leadsRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/leads/new/:pipelineId — find which team owns this pipeline, then fetch leads
  router.get("/new/:pipelineId", async (req: AuthRequest, res) => {
    const { pipelineId } = req.params;
    const { from, to } = req.query;
    const userTeams = req.userTeams || [];

    try {
      // Find the team that owns this pipeline ID
      let service: KommoService | null = null;
      let pipe: any = null;

      for (const team of userTeams) {
        if (!TEAMS[team].subdomain) continue;
        const pipelines = await services[team].getPipelines();
        const found = pipelines.find((p: any) => p.id === parseInt(pipelineId as string));
        if (found) {
          service = services[team];
          pipe = found;
          break;
        }
      }

      if (!service || !pipe) {
        return res.status(404).json({ error: "Pipeline não encontrado" });
      }

      const newLeadStatuses = pipe._embedded.statuses
        .filter((s: any) =>
          s.name.toUpperCase().includes("NEW LEADS") ||
          s.name.toUpperCase().includes("ENTRADA")
        )
        .map((s: any) => s.id);

      if (newLeadStatuses.length === 0 && pipe._embedded.statuses.length > 0) {
        newLeadStatuses.push(pipe._embedded.statuses[0].id);
      }

      const filterCreated: any = { pipeline_id: [parseInt(pipelineId as string)] };
      if (from || to) {
        filterCreated.created_at = {};
        if (from) filterCreated.created_at.from = parseInt(from as string);
        if (to) filterCreated.created_at.to = parseInt(to as string);
      }

      const leadsCreated = await service.getLeads({ filter: filterCreated, limit: 250 });
      const filteredCreated = leadsCreated.filter(
        (l) => !l.name.toLowerCase().includes("autolead")
      );
      const remainingLeads = filteredCreated.filter((l) =>
        newLeadStatuses.includes(l.status_id)
      );

      const periodStr =
        from && to
          ? `${formatDateOnly(parseInt(from as string))} até ${formatDateOnly(parseInt(to as string))}`
          : "Geral";

      res.json({
        created: filteredCreated.length,
        remaining: remainingLeads.length,
        brand: pipe.name.replace("FUNIL ", ""),
        period: periodStr,
        fetchedAt: formatDateTimeGMT3(new Date()),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
