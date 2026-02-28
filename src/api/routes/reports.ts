import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey } from "../../config.js";
import { getCrmMetrics } from "../cache/crm-cache.js";
import { getActivityMetrics, ActivityMetrics } from "../cache/activity-cache.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

export function reportsRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/reports/agents — performance de agentes de todas as equipes autorizadas
  router.get("/agents", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    try {
      const byAgent: Record<string, {
        Agente: string;
        "Total Leads": number;
        _won: number;
        _lost: number;
        funnels: Record<string, number>;
      }> = {};

      for (const team of userTeams) {
        const service = services[team];
        if (!service) continue;

        const metrics = await getCrmMetrics(team, service);

        for (const v of metrics.vendedores) {
          if (!byAgent[v.nome]) {
            byAgent[v.nome] = { Agente: v.nome, "Total Leads": 0, _won: 0, _lost: 0, funnels: {} };
          }
          byAgent[v.nome]["Total Leads"] += v.total;
          byAgent[v.nome]._won += v.ganhos;
          byAgent[v.nome]._lost += v.perdidos;
          byAgent[v.nome].funnels[v.funil.replace("FUNIL ", "")] = v.ativos;
        }
      }

      const rows = Object.values(byAgent)
        .sort((a, b) => b["Total Leads"] - a["Total Leads"])
        .map((a) => {
          const total = a["Total Leads"] || 1;
          const wonPct = ((a._won / total) * 100).toFixed(1);
          const lostPct = ((a._lost / total) * 100).toFixed(1);
          const convBase = a._won + a._lost;
          const convPct = convBase > 0 ? ((a._won / convBase) * 100).toFixed(1) : "0.0";
          return {
            Agente: a.Agente,
            "Total Leads": a["Total Leads"],
            "Venda Ganha": `${a._won} (${wonPct}%)`,
            "Venda Perdida": `${a._lost} (${lostPct}%)`,
            "Conversão %": `${convPct}%`,
            ...a.funnels,
          };
        });

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/summary — novos hoje/mês + ativos por funil para todas as equipes autorizadas
  router.get("/summary", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    try {
      const result: Array<{
        nome: string;
        team: TeamKey;
        novosHoje: number;
        novosMes: number;
        ativos: number;
      }> = [];

      for (const team of userTeams) {
        const service = services[team];
        if (!service) continue;

        const metrics = await getCrmMetrics(team, service);
        for (const funil of Object.values(metrics.funis)) {
          result.push({
            nome: funil.nome,
            team,
            novosHoje: funil.novosHoje,
            novosMes: funil.novosMes,
            ativos: funil.ativos,
          });
        }
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/activity — leads sem atividade e tarefas vencidas por equipe
  router.get("/activity", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    try {
      const result: Array<{
        team: TeamKey;
        label: string;
        activity: ActivityMetrics;
      }> = [];

      for (const team of userTeams) {
        const service = services[team];
        if (!service) continue;

        const crmMetrics = await getCrmMetrics(team, service);
        const activity = await getActivityMetrics(team, service, crmMetrics);
        result.push({ team, label: team === "azul" ? "Equipe Azul" : "Equipe Amarela", activity });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
