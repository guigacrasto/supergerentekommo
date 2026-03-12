import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { getTeamConfigsFromTenant } from "../../config.js";
import { getCrmMetrics } from "../cache/crm-cache.js";
import { getActivityMetrics, ActivityMetrics } from "../cache/activity-cache.js";
import { AuthRequest } from "../middleware/requireAuth.js";
import { filterCrmMetrics, parseTagsFromQuery } from "../helpers/filter-metrics.js";
import { calculatePredictions } from "../services/prediction.js";

export function reportsRouter() {
  const router = Router();

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

  function getCustomFieldValueWithContacts(
    lead: any,
    fieldNamePattern: RegExp,
    contactCfByLead: Record<number, any[]>,
  ): string | null {
    // 1. Tenta no lead
    const fromLead = getCustomFieldValue(lead, fieldNamePattern);
    if (fromLead) return fromLead;
    // 2. Tenta nos contatos vinculados
    const contactCfs = contactCfByLead[lead.id];
    if (!contactCfs) return null;
    for (const cf of contactCfs) {
      if (fieldNamePattern.test(cf.field_name || "")) {
        return cf.values?.[0]?.value?.toString() || null;
      }
    }
    return null;
  }

  // Build group user IDs set considering both permission and explicit filter
  function buildGroupFilter(
    allMetrics: Array<{ team: string; metrics: any }>,
    groupFilter: string,
    allowedGroups: Record<string, string[]>,
  ): { groupUserIds: Set<number> | null; allGroups: Set<string> } {
    let groupUserIds: Set<number> | null = null;
    const allGroups = new Set<string>();

    for (const { team, metrics } of allMetrics) {
      const teamAllowed = allowedGroups[team] || [];
      const hasPermRestriction = teamAllowed.length > 0;

      for (const [userId, groupName] of Object.entries(metrics.userGroups as Record<string, string>)) {
        // Skip groups not in user's allowed list (if restriction exists)
        if (hasPermRestriction && !teamAllowed.includes(groupName)) continue;

        allGroups.add(groupName);

        // Apply explicit filter or permission restriction
        if (groupFilter && groupName === groupFilter) {
          if (!groupUserIds) groupUserIds = new Set<number>();
          groupUserIds.add(Number(userId));
        } else if (!groupFilter && hasPermRestriction) {
          // No explicit filter but has perm restriction — include all allowed
          if (!groupUserIds) groupUserIds = new Set<number>();
          groupUserIds.add(Number(userId));
        }
      }
    }

    return { groupUserIds, allGroups };
  }

  async function getFilteredMetrics(req: AuthRequest) {
    const teamConfigs = getTeamConfigsFromTenant(req.tenant);
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const allowedGroups = req.allowedGroups || {};
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    const results = await Promise.all(
      userTeams.filter((t) => !!teamConfigs[t] && teamConfigs[t].subdomain).map(async (team) => {
        const cfg = teamConfigs[team];
        const kommoService = new KommoService(cfg, team, req.tenantId);
        const raw = await getCrmMetrics(team, kommoService, req.tenantId, cfg.excludePipelineNames);
        const filtered = filterCrmMetrics(raw, {
          tags,
          tagMode,
          allowedFunnels: allowedFunnels[team] || [],
          allowedGroups: allowedGroups[team] || [],
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
    const teamFilter = typeof req.query.team === "string" ? req.query.team : "";
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";

    try {
      const byAgent: Record<string, {
        Agente: string;
        "Total Leads": number;
        _won: number;
        _lost: number;
        funnels: Record<string, number>;
      }> = {};

      let allMetrics = await getFilteredMetrics(req);
      if (teamFilter) {
        allMetrics = allMetrics.filter(({ team }) => team === teamFilter);
      }

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

      for (const { metrics } of allMetrics) {
        for (const v of metrics.vendedores) {
          // Apply group filter: look up userId for this agent
          if (groupUserIds) {
            const uid = Object.entries(metrics.userNames).find(([, name]) => name === v.nome)?.[0];
            if (uid && !groupUserIds.has(Number(uid))) continue;
          }

          if (!byAgent[v.nome]) {
            byAgent[v.nome] = { Agente: v.nome, "Total Leads": 0, _won: 0, _lost: 0, funnels: {} };
          }
          byAgent[v.nome]["Total Leads"] += v.total;
          byAgent[v.nome]._won += v.ganhos;
          byAgent[v.nome]._lost += v.perdidos;
          byAgent[v.nome].funnels[v.funil.replace(/^FUNIL\s+/i, "")] = v.ativos;
        }
      }

      // Collect ALL funnel names so every agent gets a 0 for missing funnels
      const allFunnelNames = new Set<string>();
      for (const a of Object.values(byAgent)) {
        for (const f of Object.keys(a.funnels)) allFunnelNames.add(f);
      }

      const rows = Object.values(byAgent)
        .sort((a, b) => b["Total Leads"] - a["Total Leads"])
        .map((a) => {
          const total = a["Total Leads"] || 1;
          const wonPct = ((a._won / total) * 100).toFixed(1);
          const lostPct = ((a._lost / total) * 100).toFixed(1);
          const convPct = total > 0 ? ((a._won / a["Total Leads"]) * 100).toFixed(1) : "0.0";
          // Ensure every funnel column has a value (0 if not present)
          const funnelValues: Record<string, number> = {};
          for (const f of allFunnelNames) {
            funnelValues[f] = a.funnels[f] ?? 0;
          }
          return {
            Agente: a.Agente,
            "Total Leads": a["Total Leads"],
            "Venda Ganha": `${a._won} (${wonPct}%)`,
            "Venda Perdida": `${a._lost} (${lostPct}%)`,
            "Conversão %": `${convPct}%`,
            ...funnelValues,
          };
        });

      res.json({ rows, grupos: Array.from(allGroups).sort() });
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
        team: string;
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
    const teamConfigs = getTeamConfigsFromTenant(req.tenant);
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    try {
      const result: Array<{
        team: string;
        label: string;
        activity: ActivityMetrics;
      }> = [];

      const activityResults = await Promise.all(
        userTeams.filter((t) => !!teamConfigs[t] && teamConfigs[t].subdomain).map(async (team) => {
          try {
            const cfg = teamConfigs[team];
            const kommoService = new KommoService(cfg, team, req.tenantId);
            const raw = await getCrmMetrics(team, kommoService, req.tenantId, cfg.excludePipelineNames);
            const filtered = filterCrmMetrics(raw, {
              tags, tagMode,
              allowedFunnels: allowedFunnels[team] || [],
              allowedGroups: (req.allowedGroups || {})[team] || [],
              pausedPipelines, isAdmin,
            });
            const activity = await getActivityMetrics(team, kommoService, filtered, { dddProibidoEnabled: req.tenant?.settings?.dddProibidoEnabled === true });
            const funis = Object.values(filtered.pipelineNames).sort();
            const agentes = [...new Set(filtered.vendedores.map((v) => v.nome))].sort();
            const grupos = [...new Set(Object.values(filtered.userGroups).filter(Boolean))].sort();
            return { team, label: cfg.label, activity, funis, grupos, agentes };
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
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";

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

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

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
          // Skip agents not in allowed groups
          if (groupUserIds && !groupUserIds.has(Number(userId))) continue;
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
        // Filter by group
        if (groupUserIds) {
          leads = leads.filter((l) => groupUserIds!.has(l.responsible_user_id));
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

      res.json({ metrics: result, funis, agentes, grupos: Array.from(allGroups).sort() });
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
    const funilFilter = typeof req.query.funil === "string" ? req.query.funil : "";
    const agenteFilter = typeof req.query.agente === "string" ? req.query.agente : "";
    const teamFilterParam = typeof req.query.team === "string" ? req.query.team : "";
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";

    try {
      let allMetrics = await getFilteredMetrics(req);
      if (teamFilterParam) {
        allMetrics = allMetrics.filter(({ team }) => team === teamFilterParam);
      }

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

      // Collect funnel/agent lists and build lookup maps
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
          if (groupUserIds && !groupUserIds.has(Number(userId))) continue;
          agentesSet.add(userName);
          if (!agenteNameToIds.has(userName)) agenteNameToIds.set(userName, new Set());
          agenteNameToIds.get(userName)!.add(Number(userId));
        }
      }
      const funis = Array.from(funisSet).sort();
      const agentes = Array.from(agentesSet).sort();

      const filterPipelineIds = funilFilter ? pipelineNameToIds.get(funilFilter) : null;
      const filterAgenteIds = agenteFilter ? agenteNameToIds.get(agenteFilter) : null;

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
          if (lead.status_id !== STATUS_WON) continue;
          if (lead.closed_at < fromTs || lead.closed_at > toTs) continue;
          if (filterPipelineIds && !filterPipelineIds.has(lead.pipeline_id)) continue;
          if (filterAgenteIds && !filterAgenteIds.has(lead.responsible_user_id)) continue;
          if (groupUserIds && !groupUserIds.has(lead.responsible_user_id)) continue;
          wonLeads.push({
            responsible_user_id: lead.responsible_user_id,
            created_at: lead.created_at,
            closed_at: lead.closed_at,
          });
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
      const pctFechamentoDia = totalLeads > 0
        ? ((totalFechamentoDia / totalLeads) * 100).toFixed(1) + "%"
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
        pctFechamentoDia,
        porAgente,
        funis,
        agentes,
        grupos: Array.from(allGroups).sort(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/loss-reasons?from=YYYY-MM-DD&to=YYYY-MM-DD&funil=X&agente=X&team=X — Motivos de Perda
  router.get("/loss-reasons", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_LOST = 143;
    const funilFilter = typeof req.query.funil === "string" ? req.query.funil : "";
    const agenteFilter = typeof req.query.agente === "string" ? req.query.agente : "";
    const teamFilter = typeof req.query.team === "string" ? req.query.team : "";
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";

    try {
      const allMetrics = await getFilteredMetrics(req);

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

      // Collect all lost leads in range
      const lostLeads: Array<{
        responsible_user_id: number;
        motivo: string;
        pipeline_id: number;
      }> = [];
      let userNamesMap: Record<number, string> = {};
      let lossReasonNamesMap: Record<number, string> = {};
      let pipelineNamesMap: Record<number, string> = {};
      const allAgentNames = new Set<string>();
      const allFunilNames = new Set<string>();

      for (const { team, metrics } of allMetrics) {
        if (teamFilter && team !== teamFilter) continue;
        Object.assign(userNamesMap, metrics.userNames);
        Object.assign(lossReasonNamesMap, metrics.lossReasonNames);
        Object.assign(pipelineNamesMap, metrics.pipelineNames);

        // Collect unique agente/funil names (filtered by group permissions)
        for (const v of metrics.vendedores) {
          // Look up userId for this agent name
          const uid = Object.entries(metrics.userNames).find(([, name]) => name === v.nome)?.[0];
          if (uid && groupUserIds && !groupUserIds.has(Number(uid))) continue;
          allAgentNames.add(v.nome);
          allFunilNames.add(v.funil.replace(/^FUNIL\s+/i, ""));
        }

        for (const lead of metrics.leadSnapshots) {
          if (
            lead.status_id === STATUS_LOST &&
            lead.closed_at >= fromTs &&
            lead.closed_at <= toTs
          ) {
            // Apply funil filter
            if (funilFilter) {
              const pName = (pipelineNamesMap[lead.pipeline_id] || "").replace(/^FUNIL\s+/i, "");
              if (pName !== funilFilter) continue;
            }
            // Apply agente filter
            if (agenteFilter) {
              const agentName = userNamesMap[lead.responsible_user_id] || "";
              if (agentName !== agenteFilter) continue;
            }
            // Apply group filter
            if (groupUserIds && !groupUserIds.has(lead.responsible_user_id)) continue;

            // Resolve loss reason: 1) native loss_reason_id map, 2) custom field, 3) fallback
            let motivo = "Sem motivo";
            if (lead.loss_reason_id && lossReasonNamesMap[lead.loss_reason_id]) {
              motivo = lossReasonNamesMap[lead.loss_reason_id];
            } else {
              const motivoCf = getCustomFieldValue(lead, /motivo\s*de?\s*perd/i);
              if (motivoCf) motivo = motivoCf;
            }

            lostLeads.push({
              responsible_user_id: lead.responsible_user_id,
              motivo,
              pipeline_id: lead.pipeline_id,
            });
          }
        }
      }

      const totalPerdidos = lostLeads.length;

      // Count total resolved leads (won + lost) for percentage calculation
      const STATUS_WON = 142;
      let totalResolvedLeads = 0;
      for (const { team: t, metrics: m } of allMetrics) {
        if (teamFilter && t !== teamFilter) continue;
        for (const lead of m.leadSnapshots) {
          if (lead.closed_at < fromTs || lead.closed_at > toTs) continue;
          if (lead.status_id !== STATUS_LOST && lead.status_id !== STATUS_WON) continue;
          if (funilFilter) {
            const pName = (pipelineNamesMap[lead.pipeline_id] || "").replace(/^FUNIL\s+/i, "");
            if (pName !== funilFilter) continue;
          }
          if (agenteFilter) {
            const agentName = userNamesMap[lead.responsible_user_id] || "";
            if (agentName !== agenteFilter) continue;
          }
          if (groupUserIds && !groupUserIds.has(lead.responsible_user_id)) continue;
          totalResolvedLeads++;
        }
      }
      const pctPerdidos = totalResolvedLeads > 0
        ? ((totalPerdidos / totalResolvedLeads) * 100).toFixed(1) + "%"
        : "0.0%";

      // Group by motivo
      const motivosMap: Record<string, number> = {};
      for (const lead of lostLeads) {
        motivosMap[lead.motivo] = (motivosMap[lead.motivo] || 0) + 1;
      }

      const motivos = Object.entries(motivosMap)
        .map(([nome, count]) => ({
          nome,
          count,
          pct: totalPerdidos > 0 ? ((count / totalPerdidos) * 100).toFixed(1) + "%" : "0.0%",
        }))
        .sort((a, b) => b.count - a.count);

      // Group by agent with breakdown by motivo
      const porAgenteMap: Record<number, Record<string, number>> = {};
      for (const lead of lostLeads) {
        if (!porAgenteMap[lead.responsible_user_id]) {
          porAgenteMap[lead.responsible_user_id] = {};
        }
        porAgenteMap[lead.responsible_user_id][lead.motivo] =
          (porAgenteMap[lead.responsible_user_id][lead.motivo] || 0) + 1;
      }

      const porAgente = Object.entries(porAgenteMap)
        .map(([userId, reasons]) => {
          const total = Object.values(reasons).reduce((s, c) => s + c, 0);
          const motivosList = Object.entries(reasons)
            .map(([nome, count]) => ({
              nome,
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

      const funis = Array.from(allFunilNames).sort();
      const agentes = Array.from(allAgentNames).sort();

      res.json({ motivos, porAgente, totalPerdidos, pctPerdidos, funis, agentes, grupos: Array.from(allGroups).sort() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/custom-fields-debug — list all unique custom field names across leads and contacts
  router.get("/custom-fields-debug", async (req: AuthRequest, res) => {
    try {
      const allMetrics = await getFilteredMetrics(req);

      const leadFieldCounts: Record<string, number> = {};
      const contactFieldCounts: Record<string, number> = {};
      let totalLeads = 0;
      let leadsWithCf = 0;
      let leadsWithContactCf = 0;

      // Sample renda values (first 50 unique)
      const rendaPattern = /renda|sal[aá]rio|income|faixa.*sal|receita/i;
      const rendaSamples: Array<{ leadId: number; fieldName: string; value: string; source: string }> = [];

      for (const { metrics } of allMetrics) {
        for (const lead of metrics.leadSnapshots) {
          totalLeads++;
          if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            leadsWithCf++;
            for (const cf of lead.custom_fields_values) {
              const name = cf.field_name || cf.field_code || "unknown";
              leadFieldCounts[name] = (leadFieldCounts[name] || 0) + 1;
              if (rendaPattern.test(name) && rendaSamples.length < 50) {
                rendaSamples.push({ leadId: lead.id, fieldName: name, value: cf.values?.[0]?.value?.toString() || "", source: "lead" });
              }
            }
          }
          const contactCfs = metrics.contactCfByLead[lead.id];
          if (contactCfs && contactCfs.length > 0) {
            leadsWithContactCf++;
            for (const cf of contactCfs) {
              const name = cf.field_name || cf.field_code || "unknown";
              contactFieldCounts[name] = (contactFieldCounts[name] || 0) + 1;
              if (rendaPattern.test(name) && rendaSamples.length < 50) {
                rendaSamples.push({ leadId: lead.id, fieldName: name, value: cf.values?.[0]?.value?.toString() || "", source: "contact" });
              }
            }
          }
        }
      }

      // Sort by count descending
      const leadFields = Object.entries(leadFieldCounts).sort((a, b) => b[1] - a[1]);
      const contactFields = Object.entries(contactFieldCounts).sort((a, b) => b[1] - a[1]);

      res.json({
        totalLeads,
        leadsWithCustomFields: leadsWithCf,
        leadsWithContactCustomFields: leadsWithContactCf,
        leadFields: leadFields.map(([name, count]) => ({ name, count })),
        contactFields: contactFields.map(([name, count]) => ({ name, count })),
        rendaSamples,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/income?from=YYYY-MM-DD&to=YYYY-MM-DD — Renda do Lead
  router.get("/income", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_WON = 142;
    const rendaPattern = /renda|sal[aá]rio|income|faixa.*sal|receita/i;
    const teamFilter = typeof req.query.team === "string" ? req.query.team : "";
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";
    const funilFilter = typeof req.query.funil === "string" ? req.query.funil : "";

    const brackets: Array<{ label: string; min: number; max: number }> = [
      { label: "Até R$ 2.000", min: 0, max: 2000 },
      { label: "R$ 2.001 a R$ 5.000", min: 2001, max: 5000 },
      { label: "R$ 5.001 a R$ 10.000", min: 5001, max: 10000 },
      { label: "R$ 10.001 a R$ 20.000", min: 10001, max: 20000 },
      { label: "Acima de R$ 20.000", min: 20001, max: Infinity },
    ];

    try {
      const allMetrics = await getFilteredMetrics(req);

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

      // Collect leads in date range
      const leads: Array<{
        status_id: number;
        price: number;
        renda: string | null;
        wonInRange: boolean;
      }> = [];
      let pipelineNamesMap: Record<number, string> = {};
      const allFunilNames = new Set<string>();

      for (const { team, metrics } of allMetrics) {
        if (teamFilter && team !== teamFilter) continue;
        Object.assign(pipelineNamesMap, metrics.pipelineNames);
        for (const v of metrics.vendedores) {
          allFunilNames.add(v.funil.replace(/^FUNIL\s+/i, ""));
        }
        for (const lead of metrics.leadSnapshots) {
          if (groupUserIds && !groupUserIds.has(lead.responsible_user_id)) continue;
          if (funilFilter) {
            const pName = (pipelineNamesMap[lead.pipeline_id] || "").replace(/^FUNIL\s+/i, "");
            if (pName !== funilFilter) continue;
          }
          const isWonInRange = lead.status_id === STATUS_WON && lead.closed_at >= fromTs && lead.closed_at <= toTs;
          leads.push({
            status_id: lead.status_id,
            price: lead.price || 0,
            renda: getCustomFieldValueWithContacts(lead, rendaPattern, metrics.contactCfByLead),
            wonInRange: isWonInRange,
          });
        }
      }

      // Initialize brackets + "Não informado"
      const faixasMap: Record<string, { volume: number; fechamentos: number; totalPrice: number }> = {};
      for (const b of brackets) {
        faixasMap[b.label] = { volume: 0, fechamentos: 0, totalPrice: 0 };
      }
      faixasMap["Não informado"] = { volume: 0, fechamentos: 0, totalPrice: 0 };

      // Helper: parse any renda value into a number (handles Brazilian formats, "mil", "k", etc.)
      function parseRendaValue(raw: string): number {
        const s = raw.trim().toLowerCase();

        // "mil" / "k" multiplier: "5 mil" → 5000, "5k" → 5000, "1.5k" → 1500
        const milMatch = s.match(/^[r$\s]*([\d.,]+)\s*(mil|k)\b/i);
        if (milMatch) {
          const num = parseSimpleNumber(milMatch[1]);
          return isNaN(num) ? NaN : num * 1000;
        }

        // Standalone "mil" → 1000
        if (/^\s*(um\s+)?mil\s*$/i.test(s)) return 1000;

        // Strip currency symbols, "reais", "real", "brl", spaces: "R$ 3.000 reais" → "3.000"
        let digits = raw
          .replace(/reais|real|brl/gi, "")
          .replace(/[r$\s]/gi, "")
          .trim();

        return parseSimpleNumber(digits);
      }

      // Parse a number string handling both Brazilian (5.000,50) and English (5,000.50) formats
      function parseSimpleNumber(digits: string): number {
        if (!digits) return NaN;
        // Both dot and comma present
        if (digits.includes(".") && digits.includes(",")) {
          const lastDot = digits.lastIndexOf(".");
          const lastComma = digits.lastIndexOf(",");
          if (lastComma > lastDot) {
            // Brazilian: 5.000,50 → dot is thousands, comma is decimal
            digits = digits.replace(/\./g, "").replace(",", ".");
          } else {
            // English: 5,000.50 → comma is thousands, dot is decimal
            digits = digits.replace(/,/g, "");
          }
        } else if (digits.includes(",")) {
          // Only comma: could be "5,000" (English thousands) or "5,50" (Brazilian decimal)
          const parts = digits.split(",");
          if (parts.length === 2 && parts[1].length === 3) {
            digits = digits.replace(",", ""); // English thousands: "5,000" → "5000"
          } else {
            digits = digits.replace(",", "."); // Decimal: "5,50" → "5.50"
          }
        } else if (digits.includes(".")) {
          // Only dot: could be "5.000" (Brazilian thousands) or "5.5" (decimal)
          const parts = digits.split(".");
          if (parts.length === 2 && parts[1].length === 3) {
            digits = digits.replace(".", ""); // Brazilian thousands: "5.000" → "5000"
          }
          // Multiple dots: "5.000.000" → thousands separators
          if (parts.length > 2) {
            digits = digits.replace(/\./g, "");
          }
        }
        return parseFloat(digits);
      }

      // Helper: match renda string directly against known Kommo enum values and patterns
      function matchBracketLabel(raw: string): string | null {
        const lower = raw.toLowerCase().trim();

        // Direct label match
        for (const b of brackets) {
          if (lower.includes(b.label.toLowerCase())) return b.label;
        }

        // Kommo enum formats: "De R$1 mil a R$2 mil", "De R$2 mil a R$5 mil", etc.
        if (/r?\$?\s*1\s*mil\s*(a|[-–])\s*r?\$?\s*2\s*mil/i.test(raw)) return brackets[0].label;
        if (/at[eé]\s*(r?\$?\s*)?(1|2)\s*(mil|\.?000)/i.test(raw)) return brackets[0].label;
        if (/r?\$?\s*2\s*mil\s*(a|[-–])\s*r?\$?\s*5\s*mil/i.test(raw)) return brackets[1].label;
        if (/r?\$?\s*5\s*mil\s*(a|[-–])\s*r?\$?\s*10\s*mil/i.test(raw)) return brackets[2].label;
        if (/r?\$?\s*10\s*mil\s*(a|[-–])\s*r?\$?\s*(15|20)\s*mil/i.test(raw)) return brackets[3].label;
        if (/r?\$?\s*(15|20)\s*mil\s*(a|[-–])\s*r?\$?\s*(20|30|50)\s*mil/i.test(raw)) return brackets[4].label;
        if (/acima|mais\s*de\s*(r?\$?\s*)?(15|20)/i.test(raw)) return brackets[4].label;

        // Numeric patterns with thousands: "2.000 a 5.000", "2,000 a 5,000"
        if (/2[\.\s,]?00[01]\s*(a|[-–])\s*(r?\$?\s*)?5[\.\s,]?000/i.test(raw)) return brackets[1].label;
        if (/5[\.\s,]?00[01]\s*(a|[-–])\s*(r?\$?\s*)?10[\.\s,]?000/i.test(raw)) return brackets[2].label;
        if (/10[\.\s,]?00[01]\s*(a|[-–])\s*(r?\$?\s*)?20[\.\s,]?000/i.test(raw)) return brackets[3].label;

        // Simple ranges: "2 a 5 mil", "5 a 10 mil", "10 a 15 mil"
        if (/\b(de\s+)?(r?\$?\s*)?1\s*(a|[-–])\s*(r?\$?\s*)?2\s*(mil|k)/i.test(raw)) return brackets[0].label;
        if (/\b(de\s+)?(r?\$?\s*)?2\s*(a|[-–])\s*(r?\$?\s*)?5\s*(mil|k)/i.test(raw)) return brackets[1].label;
        if (/\b(de\s+)?(r?\$?\s*)?5\s*(a|[-–])\s*(r?\$?\s*)?10\s*(mil|k)/i.test(raw)) return brackets[2].label;
        if (/\b(de\s+)?(r?\$?\s*)?10\s*(a|[-–])\s*(r?\$?\s*)?(15|20)\s*(mil|k)/i.test(raw)) return brackets[3].label;
        if (/\b(de\s+)?(r?\$?\s*)?(15|20)\s*(a|[-–])\s*(r?\$?\s*)?(20|30|50)\s*(mil|k)/i.test(raw)) return brackets[4].label;

        return null;
      }

      // Debug: log unique renda values
      const rendaDebug = new Map<string, number>();

      for (const lead of leads) {
        let bracketLabel = "Não informado";

        if (lead.renda) {
          // Count for debug
          rendaDebug.set(lead.renda, (rendaDebug.get(lead.renda) || 0) + 1);

          // 1. Try direct label matching (enum/select fields)
          const labelMatch = matchBracketLabel(lead.renda);
          if (labelMatch) {
            bracketLabel = labelMatch;
          } else {
            // 2. Try parsing as number (handles "5 mil", "5k", "5.000", "5,000", etc.)
            const rendaValue = parseRendaValue(lead.renda);
            if (!isNaN(rendaValue) && rendaValue > 0) {
              for (const b of brackets) {
                if (rendaValue >= b.min && rendaValue <= b.max) {
                  bracketLabel = b.label;
                  break;
                }
              }
            }
          }
        }

        faixasMap[bracketLabel].volume++;
        if (lead.wonInRange) {
          faixasMap[bracketLabel].fechamentos++;
          faixasMap[bracketLabel].totalPrice += lead.price;
        }
      }

      // Log unique renda values for debugging
      console.log(`[Income] ${leads.length} leads, ${rendaDebug.size} unique renda values:`);
      for (const [val, count] of [...rendaDebug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  "${val}" → ${count}x`);
      }

      let totalVolume = 0;
      let totalFechamentos = 0;
      let totalPrice = 0;

      const faixas = [...brackets.map((b) => b.label), "Não informado"].map((label) => {
        const data = faixasMap[label];
        totalVolume += data.volume;
        totalFechamentos += data.fechamentos;
        totalPrice += data.totalPrice;
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

      const pctConversao = totalVolume > 0
        ? ((totalFechamentos / totalVolume) * 100).toFixed(1) + "%"
        : "0.0%";
      const ticketMedioGeral = totalFechamentos > 0
        ? Math.round(totalPrice / totalFechamentos)
        : 0;

      res.json({
        faixas,
        totalVolume,
        totalFechamentos,
        pctConversao,
        ticketMedioGeral,
        funis: Array.from(allFunilNames).sort(),
        grupos: Array.from(allGroups).sort(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/profession?from=YYYY-MM-DD&to=YYYY-MM-DD — Profissão do Lead
  router.get("/profession", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_WON = 142;
    const profissaoPattern = /profiss[aã]o|ocupa[cç][aã]o|cargo|profession|job/i;
    const teamFilter = typeof req.query.team === "string" ? req.query.team : "";
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";
    const funilFilter = typeof req.query.funil === "string" ? req.query.funil : "";

    try {
      const allMetrics = await getFilteredMetrics(req);

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

      // Collect leads in date range
      const leads: Array<{
        status_id: number;
        price: number;
        profissao: string | null;
      }> = [];
      let pipelineNamesMap: Record<number, string> = {};
      const allFunilNames = new Set<string>();

      for (const { team, metrics } of allMetrics) {
        if (teamFilter && team !== teamFilter) continue;
        Object.assign(pipelineNamesMap, metrics.pipelineNames);
        for (const v of metrics.vendedores) {
          allFunilNames.add(v.funil.replace(/^FUNIL\s+/i, ""));
        }
        for (const lead of metrics.leadSnapshots) {
          if (lead.created_at >= fromTs && lead.created_at <= toTs) {
            if (groupUserIds && !groupUserIds.has(lead.responsible_user_id)) continue;
            if (funilFilter) {
              const pName = (pipelineNamesMap[lead.pipeline_id] || "").replace(/^FUNIL\s+/i, "");
              if (pName !== funilFilter) continue;
            }
            leads.push({
              status_id: lead.status_id,
              price: lead.price || 0,
              profissao: getCustomFieldValueWithContacts(lead, profissaoPattern, metrics.contactCfByLead),
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

      res.json({ profissoes, funis: Array.from(allFunilNames).sort(), grupos: Array.from(allGroups).sort() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DDD → Estado brasileiro
  const DDD_TO_ESTADO: Record<string, string> = {
    "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP",
    "16": "SP", "17": "SP", "18": "SP", "19": "SP",
    "21": "RJ", "22": "RJ", "24": "RJ",
    "27": "ES", "28": "ES",
    "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
    "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
    "47": "SC", "48": "SC", "49": "SC",
    "51": "RS", "53": "RS", "54": "RS", "55": "RS",
    "61": "DF", "62": "GO", "63": "TO", "64": "GO",
    "65": "MT", "66": "MT", "67": "MS",
    "68": "AC", "69": "RO",
    "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
    "79": "SE",
    "81": "PE", "82": "AL", "83": "PB", "84": "RN",
    "85": "CE", "86": "PI", "87": "PE", "88": "CE", "89": "PI",
    "91": "PA", "92": "AM", "93": "PA", "94": "PA",
    "95": "RR", "96": "AP", "97": "AM", "98": "MA", "99": "MA",
  };

  // GET /api/reports/ddd?from=YYYY-MM-DD&to=YYYY-MM-DD&estado=XX — Leads por DDD (código de área)
  router.get("/ddd", async (req: AuthRequest, res) => {
    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_WON = 142;
    const teamFilter = typeof req.query.team === "string" ? req.query.team : "";
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";
    const funilFilter = typeof req.query.funil === "string" ? req.query.funil : "";
    const estadoFilter = typeof req.query.estado === "string" ? req.query.estado : "";

    try {
      const allMetrics = await getFilteredMetrics(req);

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

      // Helper: extract phone from lead or contact custom fields
      function getPhone(lead: any, contactCfByLead: Record<number, any[]>): string | null {
        if (lead.custom_fields_values) {
          for (const cf of lead.custom_fields_values) {
            if (cf.field_code === "PHONE" || /phone|telefone|celular/i.test(cf.field_name || "")) {
              const val = cf.values?.[0]?.value;
              if (val) return val.toString();
            }
          }
        }
        const contactCfs = contactCfByLead[lead.id];
        if (!contactCfs) return null;
        for (const cf of contactCfs) {
          if (cf.field_code === "PHONE" || /phone|telefone|celular/i.test(cf.field_name || "")) {
            const val = cf.values?.[0]?.value;
            if (val) return val.toString();
          }
        }
        return null;
      }

      // Helper: extract DDD from Brazilian phone number
      function extractDDD(phone: string): string | null {
        const digits = phone.replace(/\D/g, "");
        if (digits.startsWith("55") && digits.length >= 12) {
          return digits.substring(2, 4);
        }
        if (digits.length >= 10 && digits.length <= 11) {
          return digits.substring(0, 2);
        }
        return null;
      }

      const leads: Array<{
        status_id: number;
        price: number;
        phone: string | null;
      }> = [];
      let pipelineNamesMap: Record<number, string> = {};
      const allFunilNames = new Set<string>();

      for (const { team, metrics } of allMetrics) {
        if (teamFilter && team !== teamFilter) continue;
        Object.assign(pipelineNamesMap, metrics.pipelineNames);
        for (const v of metrics.vendedores) {
          allFunilNames.add(v.funil.replace(/^FUNIL\s+/i, ""));
        }
        for (const lead of metrics.leadSnapshots) {
          if (lead.created_at >= fromTs && lead.created_at <= toTs) {
            if (groupUserIds && !groupUserIds.has(lead.responsible_user_id)) continue;
            if (funilFilter) {
              const pName = (pipelineNamesMap[lead.pipeline_id] || "").replace(/^FUNIL\s+/i, "");
              if (pName !== funilFilter) continue;
            }
            leads.push({
              status_id: lead.status_id,
              price: lead.price || 0,
              phone: getPhone(lead, metrics.contactCfByLead),
            });
          }
        }
      }

      // Group by DDD
      const dddMap: Record<string, { volume: number; fechamentos: number; totalPrice: number }> = {};

      for (const lead of leads) {
        const ddd = lead.phone ? extractDDD(lead.phone) : null;
        const key = ddd || "Não identificado";
        const estado = DDD_TO_ESTADO[key] || "";

        // Apply estado filter
        if (estadoFilter && estado !== estadoFilter) continue;

        if (!dddMap[key]) {
          dddMap[key] = { volume: 0, fechamentos: 0, totalPrice: 0 };
        }
        dddMap[key].volume++;
        if (lead.status_id === STATUS_WON) {
          dddMap[key].fechamentos++;
          dddMap[key].totalPrice += lead.price;
        }
      }

      // Collect unique estados from all DDDs (before filter, for the dropdown)
      const allEstados = new Set<string>();
      for (const lead of leads) {
        const ddd = lead.phone ? extractDDD(lead.phone) : null;
        if (ddd && DDD_TO_ESTADO[ddd]) {
          allEstados.add(DDD_TO_ESTADO[ddd]);
        }
      }

      const ddds = Object.entries(dddMap)
        .filter(([ddd]) => ddd !== "Não identificado")
        .map(([ddd, data]) => ({
          ddd,
          estado: DDD_TO_ESTADO[ddd] || "",
          volume: data.volume,
          fechamentos: data.fechamentos,
          conversao: data.volume > 0
            ? ((data.fechamentos / data.volume) * 100).toFixed(1) + "%"
            : "0.0%",
          ticketMedio: data.fechamentos > 0
            ? Math.round(data.totalPrice / data.fechamentos)
            : 0,
        }))
        .sort((a, b) => b.volume - a.volume);

      res.json({
        ddds,
        funis: Array.from(allFunilNames).sort(),
        grupos: Array.from(allGroups).sort(),
        estados: Array.from(allEstados).sort(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/all — combined endpoint (summary + dashboard + activity in 1 request)
  router.get("/all", async (req: AuthRequest, res) => {
    const teamConfigs = getTeamConfigsFromTenant(req.tenant);
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    try {
      const teamsData = await Promise.all(
        userTeams.filter((t) => !!teamConfigs[t] && teamConfigs[t].subdomain).map(async (team) => {
          const cfg = teamConfigs[team];
          const kommoService = new KommoService(cfg, team, req.tenantId);
          const raw = await getCrmMetrics(team, kommoService, req.tenantId, cfg.excludePipelineNames);
          const metrics = filterCrmMetrics(raw, {
            tags, tagMode,
            allowedFunnels: allowedFunnels[team] || [],
            allowedGroups: (req.allowedGroups || {})[team] || [],
            pausedPipelines, isAdmin,
          });

          const summary = Object.values(metrics.funis).map((f) => ({
            nome: f.nome, team, novosHoje: f.novosHoje, novosMes: f.novosMes, ativos: f.ativos,
          }));

          let activity = null;
          try {
            activity = await getActivityMetrics(team, kommoService, metrics, { dddProibidoEnabled: req.tenant?.settings?.dddProibidoEnabled === true });
          } catch {}

          // Map vendedores to include group name + filter by allowed groups
          const teamAllowedGroups = (req.allowedGroups || {})[team] || [];
          const hasGroupRestriction = teamAllowedGroups.length > 0;

          const vendedores = metrics.vendedores
            .map((v) => {
              const userId = Object.entries(metrics.userNames).find(([, name]) => name === v.nome)?.[0];
              const grupo = userId ? (metrics.userGroups[Number(userId)] || "") : "";
              return {
                nome: v.nome,
                funil: v.funil,
                team,
                grupo,
                total: v.total,
                ganhos: v.ganhos,
                ganhosHoje: v.ganhosHoje,
                ganhosSemana: v.ganhosSemana,
                ativos: v.ativos,
              };
            })
            .filter((v) => !hasGroupRestriction || teamAllowedGroups.includes(v.grupo));

          // Re-aggregate agents from filtered vendedores (respects group permissions)
          const byAgentFiltered: Record<string, {
            nome: string; total: number; ganhos: number;
            ganhosHoje: number; ganhosSemana: number; ativos: number;
          }> = {};
          for (const v of vendedores) {
            if (!byAgentFiltered[v.nome]) {
              byAgentFiltered[v.nome] = { nome: v.nome, total: 0, ganhos: 0, ganhosHoje: 0, ganhosSemana: 0, ativos: 0 };
            }
            byAgentFiltered[v.nome].total += v.total;
            byAgentFiltered[v.nome].ganhos += v.ganhos;
            byAgentFiltered[v.nome].ganhosHoje += v.ganhosHoje;
            byAgentFiltered[v.nome].ganhosSemana += v.ganhosSemana;
            byAgentFiltered[v.nome].ativos += v.ativos;
          }
          const agents = Object.values(byAgentFiltered).sort((a, b) => b.total - a.total);

          // Collect unique groups for this team (filtered by permissions)
          const gruposSet = new Set<string>();
          for (const gName of Object.values(metrics.userGroups)) {
            if (!hasGroupRestriction || teamAllowedGroups.includes(gName)) {
              gruposSet.add(gName);
            }
          }

          return { team, label: cfg.label, summary, agents, vendedores, activity, grupos: Array.from(gruposSet).sort() };
        })
      );

      // Flatten into the format DashboardPage expects
      const summary = teamsData.flatMap((t) => t.summary);
      const vendedores = teamsData.flatMap((t) => t.vendedores);
      const agentsByTeam: Record<string, any[]> = {};
      const activityList: Array<{ team: string; label: string; activity: any }> = [];
      const gruposByTeam: Record<string, string[]> = {};
      for (const t of teamsData) {
        agentsByTeam[t.team] = t.agents;
        gruposByTeam[t.team] = t.grupos;
        if (t.activity) {
          activityList.push({
            team: t.team,
            label: t.label,
            activity: t.activity,
          });
        }
      }

      res.json({ summary, vendedores, dashboard: { agentsByTeam }, activity: activityList, gruposByTeam });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/stream — SSE stream for real-time updates (full dashboard data)
  router.get("/stream", async (req: AuthRequest, res) => {
    const teamConfigs = getTeamConfigsFromTenant(req.tenant);
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
          userTeams.filter((t) => !!teamConfigs[t] && teamConfigs[t].subdomain).map(async (team) => {
            const cfg = teamConfigs[team];
            const kommoService = new KommoService(cfg, team, req.tenantId);
            const raw = await getCrmMetrics(team, kommoService, req.tenantId, cfg.excludePipelineNames);
            const metrics = filterCrmMetrics(raw, {
              tags: [],
              tagMode: "or",
              allowedFunnels: allowedFunnels[team] || [],
              allowedGroups: (req.allowedGroups || {})[team] || [],
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

            // Activity
            let activity = null;
            try {
              activity = await getActivityMetrics(team, kommoService, metrics, { dddProibidoEnabled: req.tenant?.settings?.dddProibidoEnabled === true });
            } catch {}

            // Map vendedores + filter by allowed groups
            const sseTeamGroups = (req.allowedGroups || {})[team] || [];
            const sseHasGroupRestriction = sseTeamGroups.length > 0;

            const vendedores = metrics.vendedores
              .map((v) => {
                const userId = Object.entries(metrics.userNames).find(([, name]) => name === v.nome)?.[0];
                const grupo = userId ? (metrics.userGroups[Number(userId)] || "") : "";
                return {
                  nome: v.nome,
                  funil: v.funil,
                  team,
                  grupo,
                  total: v.total,
                  ganhos: v.ganhos,
                  ganhosHoje: v.ganhosHoje,
                  ganhosSemana: v.ganhosSemana,
                  ativos: v.ativos,
                };
              })
              .filter((v) => !sseHasGroupRestriction || sseTeamGroups.includes(v.grupo));

            // Agents aggregated from filtered vendedores
            const byAgent: Record<string, {
              nome: string; total: number; ganhos: number;
              ganhosHoje: number; ganhosSemana: number; ativos: number;
            }> = {};
            for (const v of vendedores) {
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

            // Collect unique groups (filtered by permissions)
            const gruposSet = new Set<string>();
            for (const gName of Object.values(metrics.userGroups)) {
              if (!sseHasGroupRestriction || sseTeamGroups.includes(gName)) {
                gruposSet.add(gName);
              }
            }
            const grupos = Array.from(gruposSet).sort();

            return {
              team,
              geral: metrics.geral,
              summary,
              agents,
              vendedores,
              activity,
              grupos,
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

  // GET /api/reports/predictions — Previsão de fechamento por lead
  router.get("/predictions", async (req: AuthRequest, res) => {
    try {
      const teamConfigs = getTeamConfigsFromTenant(req.tenant);
      const teams = req.userTeams || [];
      const teamFilter = typeof req.query.team === "string" ? req.query.team : teams[0];
      const funilFilter = typeof req.query.funil === "string" ? req.query.funil : undefined;
      const agenteFilter = typeof req.query.agente === "string" ? req.query.agente : undefined;

      const cfg = teamFilter ? teamConfigs[teamFilter] : undefined;
      if (!teamFilter || !teams.includes(teamFilter) || !cfg || !cfg.subdomain) {
        res.status(400).json({ error: "Equipe inválida ou sem permissão." });
        return;
      }

      const kommoService = new KommoService(cfg, teamFilter, req.tenantId);
      const metrics = await getCrmMetrics(teamFilter, kommoService, req.tenantId, cfg.excludePipelineNames);
      let predictions = calculatePredictions(metrics, teamFilter);

      // Apply filters
      if (funilFilter) {
        predictions = predictions.filter((p) => p.funil === funilFilter);
      }
      if (agenteFilter) {
        predictions = predictions.filter((p) => p.agente === agenteFilter);
      }

      res.json({
        predictions,
        total: predictions.length,
        team: teamFilter,
        subdomain: cfg.subdomain,
        atualizadoEm: metrics.atualizadoEm,
      });
    } catch (error: any) {
      console.error("[Reports] Erro em predictions:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/reports/ranking — ranking de times e agentes por BTs e faturamento
  router.get("/ranking", async (req: AuthRequest, res) => {
    // Acesso restrito: admin OU can_view_ranking
    const isAdminUser = req.userRole === "admin" || req.userRole === "superadmin";
    if (!isAdminUser && !req.canViewRanking) {
      res.status(403).json({ error: "Sem permissão para visualizar ranking." });
      return;
    }

    const { fromTs, toTs } = parseDateRange(req.query);
    const STATUS_WON = 142;
    const teamFilter = typeof req.query.team === "string" ? req.query.team : "";
    const groupFilter = typeof req.query.group === "string" ? req.query.group : "";

    try {
      let allMetrics = await getFilteredMetrics(req);
      if (teamFilter) {
        allMetrics = allMetrics.filter(({ team }) => team === teamFilter);
      }

      const { groupUserIds, allGroups } = buildGroupFilter(allMetrics, groupFilter, req.allowedGroups || {});

      // Aggregate by group (time) and by agent
      const timeMap: Record<string, { bts: number; faturamento: number; leads: number }> = {};
      const agenteMap: Record<string, { grupo: string; bts: number; faturamento: number; leads: number }> = {};

      for (const { metrics } of allMetrics) {
        for (const lead of metrics.leadSnapshots) {
          // Apply group filter
          if (groupUserIds && !groupUserIds.has(lead.responsible_user_id)) continue;

          const agentName = metrics.userNames[lead.responsible_user_id] || `ID ${lead.responsible_user_id}`;
          const groupName = metrics.userGroups[lead.responsible_user_id] || "Sem Equipe";

          // Initialize maps
          if (!timeMap[groupName]) timeMap[groupName] = { bts: 0, faturamento: 0, leads: 0 };
          if (!agenteMap[agentName]) agenteMap[agentName] = { grupo: groupName, bts: 0, faturamento: 0, leads: 0 };

          // Count all leads
          timeMap[groupName].leads++;
          agenteMap[agentName].leads++;

          // Count BTs (won in date range)
          if (lead.status_id === STATUS_WON && lead.closed_at >= fromTs && lead.closed_at <= toTs) {
            const price = lead.price || 0;
            timeMap[groupName].bts++;
            timeMap[groupName].faturamento += price;
            agenteMap[agentName].bts++;
            agenteMap[agentName].faturamento += price;
          }
        }
      }

      // Build ranking de times
      const rankingTimes = Object.entries(timeMap)
        .map(([nome, d]) => ({
          nome,
          bts: d.bts,
          faturamento: d.faturamento,
          ticketMedio: d.bts > 0 ? Math.round(d.faturamento / d.bts) : 0,
          leads: d.leads,
          conversao: d.leads > 0 ? parseFloat(((d.bts / d.leads) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.bts - a.bts);

      // Build ranking de agentes
      const rankingAgentes = Object.entries(agenteMap)
        .map(([nome, d]) => ({
          nome,
          grupo: d.grupo,
          bts: d.bts,
          faturamento: d.faturamento,
          ticketMedio: d.bts > 0 ? Math.round(d.faturamento / d.bts) : 0,
        }))
        .sort((a, b) => b.bts - a.bts);

      // Build ranking por time (detalhado)
      const rankingPorTime: Record<string, Array<{ nome: string; bts: number; faturamento: number; ticketMedio: number }>> = {};
      for (const [agente, d] of Object.entries(agenteMap)) {
        if (!rankingPorTime[d.grupo]) rankingPorTime[d.grupo] = [];
        rankingPorTime[d.grupo].push({
          nome: agente,
          bts: d.bts,
          faturamento: d.faturamento,
          ticketMedio: d.bts > 0 ? Math.round(d.faturamento / d.bts) : 0,
        });
      }
      // Sort agents within each team
      for (const grupo of Object.keys(rankingPorTime)) {
        rankingPorTime[grupo].sort((a, b) => b.bts - a.bts);
      }

      res.json({
        rankingTimes,
        rankingAgentes,
        rankingPorTime,
        grupos: Array.from(allGroups).sort(),
      });
    } catch (error: any) {
      console.error("[Reports] Erro em ranking:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
