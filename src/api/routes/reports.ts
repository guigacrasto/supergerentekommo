import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey } from "../../config.js";
import { getCrmMetrics } from "../cache/crm-cache.js";
import { getActivityMetrics, ActivityMetrics } from "../cache/activity-cache.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { filterCrmMetrics, parseTagsFromQuery } from "../helpers/filter-metrics.js";

export function reportsRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // — Helper functions —
  function parseDateRange(query: any): { fromTs: number; toTs: number } {
    const now = new Date();
    const toStr = typeof query.to === "string" && query.to.match(/^\d{4}-\d{2}-\d{2}$/) ? query.to : now.toISOString().slice(0, 10);
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 30);
    const fromStr = typeof query.from === "string" && query.from.match(/^\d{4}-\d{2}-\d{2}$/) ? query.from : fromDate.toISOString().slice(0, 10);
    const fromTs = new Date(`${fromStr}T00:00:00-03:00`).getTime() / 1000;
    const toTs = new Date(`${toStr}T23:59:59-03:00`).getTime() / 1000;
    return { fromTs, toTs };
  }

  function getCustomFieldValue(lead: any, fieldNamePattern: RegExp): string | null {
    if (!lead.custom_fields_values) return null;
    for (const cf of lead.custom_fields_values) {
      if (fieldNamePattern.test(cf.field_name || "")) {
        return cf.values?.[0]?.value?.toString() || null;
      }
    }
    return null;
  }

  async function getFilteredMetrics(req: AuthRequest) {
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    const results = await Promise.all(
      userTeams.filter((t) => !!services[t]).map(async (team) => {
        const raw = await getCrmMetrics(team, services[team]);
        const filtered = filterCrmMetrics(raw, {
          tags,
          tagMode,
          allowedFunnels: allowedFunnels[team] || [],
          pausedPipelines,
          isAdmin,
        });
        return { team, metrics: filtered };
      })
    );

    return results;
  }

  // GET /api/reports/agents — performance de agentes de todas as equipes autorizadas
  router.get("/agents", async (req: AuthRequest, res) => {
    try {
      const byAgent: Record<string, {
        Agente: string;
        "Total Leads": number;
        _won: number;
        _lost: number;
        funnels: Record<string, number>;
      }> = {};

      const allMetrics = await getFilteredMetrics(req);

      for (const { metrics } of allMetrics) {
        for (const v of metrics.vendedores) {
          if (!byAgent[v.nome]) {
            byAgent[v.nome] = { Agente: v.nome, "Total Leads": 0, _won: 0, _lost: 0, funnels: {} };
          }
          byAgent[v.nome]["Total Leads"] += v.total;
          byAgent[v.nome]._won += v.ganhos;
          byAgent[v.nome]._lost += v.perdidos;
          byAgent[v.nome].funnels[v.funil.replace(/^FUNIL\s+/i, "")] = v.ativos;
        }
      }

      const rows = Object.values(byAgent)
        .sort((a, b) => b["Total Leads"] - a["Total Leads"])
        .map((a) => {
          const total = a["Total Leads"] || 1;
          const wonPct = ((a._won / total) * 100).toFixed(1);
          const lostPct = ((a._lost / total) * 100).toFixed(1);
          const convPct = total > 0 ? ((a._won / a["Total Leads"]) * 100).toFixed(1) : "0.0";
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
    try {
      const allMetrics = await getFilteredMetrics(req);

      const result: Array<{
        nome: string;
        team: TeamKey;
        novosHoje: number;
        novosMes: number;
        ativos: number;
      }> = [];

      for (const { team, metrics } of allMetrics) {
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

  // GET /api/reports/dashboard — dados agregados por agente/equipe para o dashboard
  router.get("/dashboard", async (req: AuthRequest, res) => {
    try {
      const allMetrics = await getFilteredMetrics(req);

      const agentsByTeam: Record<string, Array<{
        nome: string;
        total: number;
        ganhos: number;
        ganhosHoje: number;
        ganhosSemana: number;
        ativos: number;
      }>> = {};

      for (const { team, metrics } of allMetrics) {
        const byAgent: Record<string, {
          nome: string;
          total: number;
          ganhos: number;
          ganhosHoje: number;
          ganhosSemana: number;
          ativos: number;
        }> = {};

        for (const v of metrics.vendedores) {
          if (!byAgent[v.nome]) {
            byAgent[v.nome] = { nome: v.nome, total: 0, ganhos: 0, ganhosHoje: 0, ganhosSemana: 0, ativos: 0 };
          }
          byAgent[v.nome].total += v.total;
          byAgent[v.nome].ganhos += v.ganhos;
          byAgent[v.nome].ganhosHoje += v.ganhosHoje;
          byAgent[v.nome].ganhosSemana += v.ganhosSemana;
          byAgent[v.nome].ativos += v.ativos;
        }

        agentsByTeam[team] = Object.values(byAgent).sort((a, b) => b.total - a.total);
      }

      res.json({ agentsByTeam });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/activity — leads sem atividade e tarefas vencidas por equipe
  router.get("/activity", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    try {
      const result: Array<{
        team: TeamKey;
        label: string;
        activity: ActivityMetrics;
      }> = [];

      const activityResults = await Promise.all(
        userTeams.filter((t) => !!services[t]).map(async (team) => {
          try {
            const raw = await getCrmMetrics(team, services[team]);
            const filtered = filterCrmMetrics(raw, {
              tags, tagMode,
              allowedFunnels: allowedFunnels[team] || [],
              pausedPipelines, isAdmin,
            });
            const activity = await getActivityMetrics(team, services[team], filtered);
            return { team, label: team === "azul" ? "Equipe Azul" : "Equipe Amarela", activity };
          } catch (teamErr: any) {
            console.error(`[/api/reports/activity] Erro na equipe ${team}:`, teamErr.message);
            return null;
          }
        })
      );
      for (const r of activityResults) {
        if (r) result.push(r);
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/daily?date=YYYY-MM-DD — métricas diárias por equipe
  router.get("/daily", async (req: AuthRequest, res) => {
    const dateStr = typeof req.query.date === "string" ? req.query.date : "";
    const dateMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
    const targetDate = dateMatch ? dateStr : new Date().toISOString().slice(0, 10);
    const funilFilter = typeof req.query.funil === "string" ? req.query.funil : "";
    const agenteFilter = typeof req.query.agente === "string" ? req.query.agente : "";

    try {
      const [year, month] = targetDate.split("-").map(Number);

      // BRT = UTC-3 (Brasil não usa horário de verão desde 2019)
      const dayStart = new Date(`${targetDate}T00:00:00-03:00`).getTime() / 1000;
      const dayEnd = new Date(`${targetDate}T23:59:59-03:00`).getTime() / 1000;

      const monthStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
      const monthStart = new Date(`${monthStartStr}T00:00:00-03:00`).getTime() / 1000;

      const lastDay = new Date(year, month, 0).getDate();
      const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const monthEnd = new Date(`${monthEndStr}T23:59:59-03:00`).getTime() / 1000;

      const STATUS_WON = 142;
      const STATUS_LOST = 143;

      const allMetrics = await getFilteredMetrics(req);

      // Collect all funnel names and agent names across teams
      const funisSet = new Set<string>();
      const agentesSet = new Set<string>();
      const pipelineNameToIds = new Map<string, Set<number>>();
      const agenteNameToIds = new Map<string, Set<number>>();

      for (const { metrics } of allMetrics) {
        for (const [key, funil] of Object.entries(metrics.funis)) {
          const cleanName = funil.nome.replace(/^FUNIL\s+/i, "");
          funisSet.add(cleanName);
          if (!pipelineNameToIds.has(cleanName)) pipelineNameToIds.set(cleanName, new Set());
          pipelineNameToIds.get(cleanName)!.add(Number(key));
        }
        for (const [userId, userName] of Object.entries(metrics.userNames)) {
          agentesSet.add(userName);
          if (!agenteNameToIds.has(userName)) agenteNameToIds.set(userName, new Set());
          agenteNameToIds.get(userName)!.add(Number(userId));
        }
      }
      const funis = Array.from(funisSet).sort();
      const agentes = Array.from(agentesSet).sort();

      // Resolve filter IDs
      const filterPipelineIds = funilFilter ? pipelineNameToIds.get(funilFilter) : null;
      const filterAgenteIds = agenteFilter ? agenteNameToIds.get(agenteFilter) : null;

      const result = allMetrics.map(({ team, metrics }) => {
        let leads = metrics.leadSnapshots;

        // Filter by pipeline if funnel is selected
        if (filterPipelineIds) {
          leads = leads.filter((l) => filterPipelineIds.has(l.pipeline_id));
        }
        // Filter by agent if selected
        if (filterAgenteIds) {
          leads = leads.filter((l) => filterAgenteIds.has(l.responsible_user_id));
        }

        const leadsDia = leads.filter((l) => l.created_at >= dayStart && l.created_at <= dayEnd).length;
        const leadsMes = leads.filter((l) => l.created_at >= monthStart && l.created_at <= monthEnd).length;

        const vendasDia = leads.filter((l) => l.status_id === STATUS_WON && l.closed_at >= dayStart && l.closed_at <= dayEnd).length;
        const vendasMes = leads.filter((l) => l.status_id === STATUS_WON && l.closed_at >= monthStart && l.closed_at <= monthEnd).length;

        const perdidasDia = leads.filter((l) => l.status_id === STATUS_LOST && l.closed_at >= dayStart && l.closed_at <= dayEnd).length;
        const perdidasMes = leads.filter((l) => l.status_id === STATUS_LOST && l.closed_at >= monthStart && l.closed_at <= monthEnd).length;

        return {
          team,
          leadsDia,
          leadsMes,
          vendasDia,
          vendasMes,
          perdidasDia,
          perdidasMes,
          conversaoDia: leadsDia > 0 ? ((vendasDia / leadsDia) * 100).toFixed(1) + "%" : "0.0%",
          conversaoMes: leadsMes > 0 ? ((vendasMes / leadsMes) * 100).toFixed(1) + "%" : "0.0%",
        };
      });

      res.json({ metrics: result, funis, agentes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/tags — lista todas as tags de todas as equipes autorizadas
  router.get("/tags", async (req: AuthRequest, res) => {
    try {
      const allMetrics = await getFilteredMetrics(req);

      const tags: Array<{ id: number; name: string; team: string }> = [];

      for (const { team, metrics } of allMetrics) {
        for (const tag of metrics.allTags) {
          tags.push({ id: tag.id, name: tag.name, team });
        }
      }

      res.json(tags);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/tmf?from=YYYY-MM-DD&to=YYYY-MM-DD — Tempo Médio de Fechamento
  router.get("/tmf", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_WON = 142;

    try {
      const allMetrics = await getFilteredMetrics(req);

      // Collect all won leads in range across all teams
      const wonLeads: Array<{
        responsible_user_id: number;
        created_at: number;
        closed_at: number;
      }> = [];
      let userNamesMap: Record<number, string> = {};

      for (const { metrics } of allMetrics) {
        Object.assign(userNamesMap, metrics.userNames);
        for (const lead of metrics.leadSnapshots) {
          if (
            lead.status_id === STATUS_WON &&
            lead.closed_at >= fromTs &&
            lead.closed_at <= toTs
          ) {
            wonLeads.push({
              responsible_user_id: lead.responsible_user_id,
              created_at: lead.created_at,
              closed_at: lead.closed_at,
            });
          }
        }
      }

      // Calculate TMF and classify
      let totalTmfSeconds = 0;
      let totalFechamentoDia = 0;
      let totalRemarketing = 0;

      const porAgenteMap: Record<number, {
        fechamentoDia: number;
        remarketing: number;
        totalSeconds: number;
        count: number;
      }> = {};

      for (const lead of wonLeads) {
        const diffSeconds = lead.closed_at - lead.created_at;
        totalTmfSeconds += diffSeconds;

        const isFechamentoDia = diffSeconds <= 86400;
        if (isFechamentoDia) {
          totalFechamentoDia++;
        } else {
          totalRemarketing++;
        }

        if (!porAgenteMap[lead.responsible_user_id]) {
          porAgenteMap[lead.responsible_user_id] = {
            fechamentoDia: 0,
            remarketing: 0,
            totalSeconds: 0,
            count: 0,
          };
        }
        const agente = porAgenteMap[lead.responsible_user_id];
        agente.count++;
        agente.totalSeconds += diffSeconds;
        if (isFechamentoDia) {
          agente.fechamentoDia++;
        } else {
          agente.remarketing++;
        }
      }

      const totalLeads = wonLeads.length;
      const tmfGeralHoras = totalLeads > 0
        ? Math.round((totalTmfSeconds / totalLeads / 3600) * 10) / 10
        : 0;
      const pctRemarketing = totalLeads > 0
        ? ((totalRemarketing / totalLeads) * 100).toFixed(1) + "%"
        : "0.0%";

      const porAgente = Object.entries(porAgenteMap)
        .map(([userId, data]) => ({
          nome: userNamesMap[Number(userId)] || `Usuário ${userId}`,
          fechamentoDia: data.fechamentoDia,
          remarketing: data.remarketing,
          tmfHoras: data.count > 0
            ? Math.round((data.totalSeconds / data.count / 3600) * 10) / 10
            : 0,
        }))
        .sort((a, b) => a.tmfHoras - b.tmfHoras);

      res.json({
        tmfGeralHoras,
        totalFechamentoDia,
        totalRemarketing,
        pctRemarketing,
        porAgente,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/loss-reasons?from=YYYY-MM-DD&to=YYYY-MM-DD — Motivos de Perda
  router.get("/loss-reasons", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_LOST = 143;

    try {
      const allMetrics = await getFilteredMetrics(req);

      // Collect all lost leads in range
      const lostLeads: Array<{
        responsible_user_id: number;
        loss_reason_id: number;
      }> = [];
      let userNamesMap: Record<number, string> = {};

      for (const { metrics } of allMetrics) {
        Object.assign(userNamesMap, metrics.userNames);
        for (const lead of metrics.leadSnapshots) {
          if (
            lead.status_id === STATUS_LOST &&
            lead.closed_at >= fromTs &&
            lead.closed_at <= toTs
          ) {
            lostLeads.push({
              responsible_user_id: lead.responsible_user_id,
              loss_reason_id: lead.loss_reason_id || 0,
            });
          }
        }
      }

      const totalPerdidos = lostLeads.length;

      // Group by loss_reason_id
      const motivosMap: Record<number, number> = {};
      for (const lead of lostLeads) {
        motivosMap[lead.loss_reason_id] = (motivosMap[lead.loss_reason_id] || 0) + 1;
      }

      const motivos = Object.entries(motivosMap)
        .map(([reasonId, count]) => ({
          loss_reason_id: Number(reasonId),
          count,
          pct: totalPerdidos > 0 ? ((count / totalPerdidos) * 100).toFixed(1) + "%" : "0.0%",
        }))
        .sort((a, b) => b.count - a.count);

      // Group by agent with breakdown by loss_reason
      const porAgenteMap: Record<number, Record<number, number>> = {};
      for (const lead of lostLeads) {
        if (!porAgenteMap[lead.responsible_user_id]) {
          porAgenteMap[lead.responsible_user_id] = {};
        }
        porAgenteMap[lead.responsible_user_id][lead.loss_reason_id] =
          (porAgenteMap[lead.responsible_user_id][lead.loss_reason_id] || 0) + 1;
      }

      const porAgente = Object.entries(porAgenteMap)
        .map(([userId, reasons]) => {
          const total = Object.values(reasons).reduce((s, c) => s + c, 0);
          const motivosList = Object.entries(reasons)
            .map(([reasonId, count]) => ({
              loss_reason_id: Number(reasonId),
              count,
            }))
            .sort((a, b) => b.count - a.count);
          return {
            nome: userNamesMap[Number(userId)] || `Usuário ${userId}`,
            total,
            motivos: motivosList,
          };
        })
        .sort((a, b) => b.total - a.total);

      res.json({ motivos, porAgente, totalPerdidos });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/income?from=YYYY-MM-DD&to=YYYY-MM-DD — Renda do Lead
  router.get("/income", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_WON = 142;
    const rendaPattern = /renda/i;

    const brackets: Array<{ label: string; min: number; max: number }> = [
      { label: "Até R$ 2.000", min: 0, max: 2000 },
      { label: "R$ 2.001 a R$ 5.000", min: 2001, max: 5000 },
      { label: "R$ 5.001 a R$ 10.000", min: 5001, max: 10000 },
      { label: "R$ 10.001 a R$ 20.000", min: 10001, max: 20000 },
      { label: "Acima de R$ 20.000", min: 20001, max: Infinity },
    ];

    try {
      const allMetrics = await getFilteredMetrics(req);

      // Collect leads in date range
      const leads: Array<{
        status_id: number;
        price: number;
        renda: string | null;
      }> = [];

      for (const { metrics } of allMetrics) {
        for (const lead of metrics.leadSnapshots) {
          if (lead.created_at >= fromTs && lead.created_at <= toTs) {
            leads.push({
              status_id: lead.status_id,
              price: lead.price || 0,
              renda: getCustomFieldValue(lead, rendaPattern),
            });
          }
        }
      }

      // Initialize brackets + "Não informado"
      const faixasMap: Record<string, { volume: number; fechamentos: number; totalPrice: number }> = {};
      for (const b of brackets) {
        faixasMap[b.label] = { volume: 0, fechamentos: 0, totalPrice: 0 };
      }
      faixasMap["Não informado"] = { volume: 0, fechamentos: 0, totalPrice: 0 };

      for (const lead of leads) {
        const rendaValue = lead.renda ? parseFloat(lead.renda.replace(/[^\d.,]/g, "").replace(",", ".")) : NaN;
        let bracketLabel = "Não informado";

        if (!isNaN(rendaValue)) {
          for (const b of brackets) {
            if (rendaValue >= b.min && rendaValue <= b.max) {
              bracketLabel = b.label;
              break;
            }
          }
        }

        faixasMap[bracketLabel].volume++;
        if (lead.status_id === STATUS_WON) {
          faixasMap[bracketLabel].fechamentos++;
          faixasMap[bracketLabel].totalPrice += lead.price;
        }
      }

      const faixas = [...brackets.map((b) => b.label), "Não informado"].map((label) => {
        const data = faixasMap[label];
        return {
          faixa: label,
          volume: data.volume,
          fechamentos: data.fechamentos,
          conversao: data.volume > 0
            ? ((data.fechamentos / data.volume) * 100).toFixed(1) + "%"
            : "0.0%",
          ticketMedio: data.fechamentos > 0
            ? Math.round(data.totalPrice / data.fechamentos)
            : 0,
        };
      });

      res.json({ faixas });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/profession?from=YYYY-MM-DD&to=YYYY-MM-DD — Profissão do Lead
  router.get("/profession", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_WON = 142;
    const profissaoPattern = /profiss[aã]o/i;

    try {
      const allMetrics = await getFilteredMetrics(req);

      // Collect leads in date range
      const leads: Array<{
        status_id: number;
        price: number;
        profissao: string | null;
      }> = [];

      for (const { metrics } of allMetrics) {
        for (const lead of metrics.leadSnapshots) {
          if (lead.created_at >= fromTs && lead.created_at <= toTs) {
            leads.push({
              status_id: lead.status_id,
              price: lead.price || 0,
              profissao: getCustomFieldValue(lead, profissaoPattern),
            });
          }
        }
      }

      // Group by profession
      const profMap: Record<string, { volume: number; fechamentos: number; totalPrice: number }> = {};

      for (const lead of leads) {
        const prof = lead.profissao?.trim() || "Não informado";
        if (!profMap[prof]) {
          profMap[prof] = { volume: 0, fechamentos: 0, totalPrice: 0 };
        }
        profMap[prof].volume++;
        if (lead.status_id === STATUS_WON) {
          profMap[prof].fechamentos++;
          profMap[prof].totalPrice += lead.price;
        }
      }

      const profissoes = Object.entries(profMap)
        .map(([profissao, data]) => ({
          profissao,
          volume: data.volume,
          fechamentos: data.fechamentos,
          conversao: data.volume > 0
            ? ((data.fechamentos / data.volume) * 100).toFixed(1) + "%"
            : "0.0%",
          ticketMedio: data.fechamentos > 0
            ? Math.round(data.totalPrice / data.fechamentos)
            : 0,
        }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 20);

      res.json({ profissoes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/all — combined endpoint (summary + dashboard + activity in 1 request)
  router.get("/all", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    try {
      const teamsData = await Promise.all(
        userTeams.filter((t) => !!services[t]).map(async (team) => {
          const raw = await getCrmMetrics(team, services[team]);
          const metrics = filterCrmMetrics(raw, {
            tags, tagMode,
            allowedFunnels: allowedFunnels[team] || [],
            pausedPipelines, isAdmin,
          });

          const summary = Object.values(metrics.funis).map((f) => ({
            nome: f.nome, team, novosHoje: f.novosHoje, novosMes: f.novosMes, ativos: f.ativos,
          }));

          const byAgent: Record<string, {
            nome: string; total: number; ganhos: number;
            ganhosHoje: number; ganhosSemana: number; ativos: number;
          }> = {};
          for (const v of metrics.vendedores) {
            if (!byAgent[v.nome]) {
              byAgent[v.nome] = { nome: v.nome, total: 0, ganhos: 0, ganhosHoje: 0, ganhosSemana: 0, ativos: 0 };
            }
            byAgent[v.nome].total += v.total;
            byAgent[v.nome].ganhos += v.ganhos;
            byAgent[v.nome].ganhosHoje += v.ganhosHoje;
            byAgent[v.nome].ganhosSemana += v.ganhosSemana;
            byAgent[v.nome].ativos += v.ativos;
          }
          const agents = Object.values(byAgent).sort((a, b) => b.total - a.total);

          let activity = null;
          try {
            activity = await getActivityMetrics(team, services[team], metrics);
          } catch {}

          const vendedores = metrics.vendedores.map((v) => ({
            nome: v.nome,
            funil: v.funil,
            team,
            total: v.total,
            ganhos: v.ganhos,
            ganhosHoje: v.ganhosHoje,
            ganhosSemana: v.ganhosSemana,
            ativos: v.ativos,
          }));

          return { team, summary, agents, vendedores, activity };
        })
      );

      // Flatten into the format DashboardPage expects
      const summary = teamsData.flatMap((t) => t.summary);
      const vendedores = teamsData.flatMap((t) => t.vendedores);
      const agentsByTeam: Record<string, any[]> = {};
      const activityList: Array<{ team: string; label: string; activity: any }> = [];
      for (const t of teamsData) {
        agentsByTeam[t.team] = t.agents;
        if (t.activity) {
          activityList.push({
            team: t.team,
            label: t.team === "azul" ? "Equipe Azul" : "Equipe Amarela",
            activity: t.activity,
          });
        }
      }

      res.json({ summary, vendedores, dashboard: { agentsByTeam }, activity: activityList });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/stream — SSE stream for real-time updates (full dashboard data)
  router.get("/stream", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendUpdate = async () => {
      try {
        const teamsData = await Promise.all(
          userTeams.filter((t) => !!services[t]).map(async (team) => {
            const raw = await getCrmMetrics(team, services[team]);
            const metrics = filterCrmMetrics(raw, {
              tags: [],
              tagMode: "or",
              allowedFunnels: allowedFunnels[team] || [],
              pausedPipelines,
              isAdmin,
            });

            // Summary: funis list
            const summary = Object.values(metrics.funis).map((f) => ({
              nome: f.nome,
              team,
              novosHoje: f.novosHoje,
              novosMes: f.novosMes,
              ativos: f.ativos,
            }));

            // Dashboard agents aggregated
            const byAgent: Record<string, {
              nome: string; total: number; ganhos: number;
              ganhosHoje: number; ganhosSemana: number; ativos: number;
            }> = {};
            for (const v of metrics.vendedores) {
              if (!byAgent[v.nome]) {
                byAgent[v.nome] = { nome: v.nome, total: 0, ganhos: 0, ganhosHoje: 0, ganhosSemana: 0, ativos: 0 };
              }
              byAgent[v.nome].total += v.total;
              byAgent[v.nome].ganhos += v.ganhos;
              byAgent[v.nome].ganhosHoje += v.ganhosHoje;
              byAgent[v.nome].ganhosSemana += v.ganhosSemana;
              byAgent[v.nome].ativos += v.ativos;
            }
            const agents = Object.values(byAgent).sort((a, b) => b.total - a.total);

            // Activity
            let activity = null;
            try {
              activity = await getActivityMetrics(team, services[team], metrics);
            } catch {}

            const vendedores = metrics.vendedores.map((v) => ({
              nome: v.nome,
              funil: v.funil,
              team,
              total: v.total,
              ganhos: v.ganhos,
              ganhosHoje: v.ganhosHoje,
              ganhosSemana: v.ganhosSemana,
              ativos: v.ativos,
            }));

            return {
              team,
              geral: metrics.geral,
              summary,
              agents,
              vendedores,
              activity,
              atualizadoEm: new Date().toISOString(),
            };
          })
        );
        const payload = JSON.stringify({ teams: teamsData });
        res.write(`data: ${payload}\n\n`);
      } catch (err: any) {
        console.error("[SSE /stream] Erro ao enviar update:", err.message);
      }
    };

    await sendUpdate();
    const interval = setInterval(sendUpdate, 30_000);
    req.on("close", () => { clearInterval(interval); });
  });

  return router;
}
