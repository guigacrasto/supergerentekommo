import { KommoService } from "../../services/kommo.js";
import { CrmMetrics } from "./crm-cache.js";

export interface AlertLead {
  id: number;
  nome: string;
  vendedor: string;
  funil: string;
  grupo: string;
  diasSemAtividade: number;
  updatedAt: number;
  kommoUrl: string;
}

export interface AlertTask {
  id: number;
  texto: string;
  vendedor: string;
  funil: string;
  grupo: string;
  leadId: number;
  leadNome: string;
  diasVencida: number;
  completeTill: number;
  kommoUrl: string;
}

export interface ActivityMetrics {
  leadsAbandonados48h: AlertLead[];
  leadsEmRisco7d: AlertLead[];
  tarefasVencidas: AlertTask[];
  leadsDDDProibido: AlertLead[];
  atualizadoEm: string;
}

const ACTIVITY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

interface ActivityCacheEntry {
  metrics: ActivityMetrics | null;
  expiresAt: number;
  fetchPromise: Promise<ActivityMetrics> | null;
}

const activityCaches = new Map<string, ActivityCacheEntry>();

async function fetchActivity(
  team: string,
  service: KommoService,
  crmMetrics: CrmMetrics
): Promise<ActivityMetrics> {
  console.log(`[ActivityCache:${team}] Buscando dados de atividade...`);

  const subdomain = service.config.subdomain;
  const now = Math.floor(Date.now() / 1000);
  const cutoff48h = now - 48 * 3600;
  const cutoff7d = now - 7 * 24 * 3600;

  const activeLeads = crmMetrics.activeLeads;

  // Lookup helpers for funil & grupo
  const pipelineNames = crmMetrics.pipelineNames;
  const userGroups = crmMetrics.userGroups;

  function mapLead(l: typeof activeLeads[0]): AlertLead {
    return {
      id: l.id,
      nome: l.titulo,
      vendedor: l.responsibleUserName,
      funil: pipelineNames[l.pipelineId] || "",
      grupo: userGroups[l.responsibleUserId] || "",
      diasSemAtividade: Math.floor((now - l.updatedAt) / 86400),
      updatedAt: l.updatedAt,
      kommoUrl: `https://${subdomain}.kommo.com/leads/detail/${l.id}`,
    };
  }

  // Leads without activity in last 48h but less than 7 days (warning tier)
  const leadsAbandonados48h: AlertLead[] = activeLeads
    .filter((l) => l.updatedAt < cutoff48h && l.updatedAt >= cutoff7d)
    .map(mapLead)
    .sort((a, b) => b.diasSemAtividade - a.diasSemAtividade);

  // Leads without activity for 7+ days (critical tier)
  const leadsEmRisco7d: AlertLead[] = activeLeads
    .filter((l) => l.updatedAt < cutoff7d)
    .map(mapLead)
    .sort((a, b) => b.diasSemAtividade - a.diasSemAtividade);

  // Overdue tasks — paginated fetch
  let tarefasVencidas: AlertTask[] = [];
  try {
    const tasks: any[] = [];
    let taskPage = 1;
    const taskLimit = 250;
    while (true) {
      console.log(`[ActivityCache:${team}] Fetching tasks page ${taskPage}...`);
      const tasksRes = await service.client.get("/tasks", {
        params: { filter: { is_completed: 0, entity_type: "leads" }, limit: taskLimit, page: taskPage },
      });
      const pageTasks: any[] = tasksRes.data?._embedded?.tasks || [];
      if (pageTasks.length === 0) break;
      tasks.push(...pageTasks);
      if (pageTasks.length < taskLimit) break;
      if (taskPage >= 10) {
        console.warn(`[ActivityCache:${team}] Reached 10 pages of tasks (${tasks.length} tasks), stopping.`);
        break;
      }
      taskPage++;
    }

    const leadNameMap = new Map<number, string>(
      activeLeads.map((l) => [l.id, l.titulo])
    );
    const leadPipelineMap = new Map<number, number>(
      activeLeads.map((l) => [l.id, l.pipelineId])
    );
    const userNameMap = new Map<number, string>(
      activeLeads.map((l) => [l.responsibleUserId, l.responsibleUserName])
    );

    tarefasVencidas = tasks
      .filter((t) => typeof t.complete_till === 'number' && t.complete_till > 0 && t.complete_till < now)
      .map((t) => ({
        id: t.id,
        texto: t.text || "Tarefa",
        vendedor: userNameMap.get(t.responsible_user_id) || `User ${t.responsible_user_id}`,
        funil: pipelineNames[leadPipelineMap.get(t.entity_id) ?? 0] || "",
        grupo: userGroups[t.responsible_user_id] || "",
        leadId: t.entity_id || 0,
        leadNome: leadNameMap.get(t.entity_id) || `Lead ${t.entity_id || 0}`,
        diasVencida: Math.max(0, Math.floor((now - t.complete_till) / 86400)),
        completeTill: t.complete_till,
        kommoUrl: `https://${subdomain}.kommo.com/leads/detail/${t.entity_id || 0}`,
      }))
      .sort((a, b) => b.diasVencida - a.diasVencida);
  } catch (err: any) {
    console.error(`[ActivityCache:${team}] Erro ao buscar tarefas:`, err.message);
  }

  // DDD Proibido — leads ativos com telefone DDD 81, 87 ou 83
  const FORBIDDEN_DDDS = new Set(["81", "87", "83"]);

  const snapshotCfMap = new Map<number, any[] | null>(
    crmMetrics.leadSnapshots.map((s) => [s.id, s.custom_fields_values])
  );

  function getPhoneFromLead(leadId: number): string | null {
    const cfValues = snapshotCfMap.get(leadId);
    if (cfValues) {
      for (const cf of cfValues) {
        if (cf.field_code === "PHONE" || /phone|telefone|celular/i.test(cf.field_name || "")) {
          const val = cf.values?.[0]?.value;
          if (val) return val.toString();
        }
      }
    }
    const contactCfs = crmMetrics.contactCfByLead[leadId];
    if (!contactCfs) return null;
    for (const cf of contactCfs) {
      if (cf.field_code === "PHONE" || /phone|telefone|celular/i.test(cf.field_name || "")) {
        const val = cf.values?.[0]?.value;
        if (val) return val.toString();
      }
    }
    return null;
  }

  function extractDDD(phone: string): string | null {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) return digits.substring(2, 4);
    if (digits.length >= 10 && digits.length <= 11) return digits.substring(0, 2);
    return null;
  }

  const leadsDDDProibido: AlertLead[] = activeLeads
    .filter((l) => {
      const phone = getPhoneFromLead(l.id);
      if (!phone) return false;
      const ddd = extractDDD(phone);
      return ddd !== null && FORBIDDEN_DDDS.has(ddd);
    })
    .map(mapLead);

  // Auto-close DDD Proibido leads as lost in Kommo
  if (leadsDDDProibido.length > 0) {
    const lossReasonId = Object.entries(crmMetrics.lossReasonNames)
      .find(([, name]) => /ddd\s*proibido/i.test(name))?.[0];

    const reasonId = lossReasonId ? Number(lossReasonId) : undefined;

    console.log(
      `[ActivityCache:${team}] Fechando ${leadsDDDProibido.length} leads DDD proibido como venda perdida (loss_reason_id=${reasonId ?? 'N/A'})...`
    );

    // Close leads in parallel (max 5 at a time to avoid rate limits)
    const BATCH_SIZE = 5;
    for (let i = 0; i < leadsDDDProibido.length; i += BATCH_SIZE) {
      const batch = leadsDDDProibido.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (lead) => {
          const closed = await service.closeLeadAsLost(lead.id, reasonId);
          if (closed) {
            try {
              await service.addNote(lead.id, `[SuperGerente] Lead fechado automaticamente — DDD Proibido`);
            } catch { /* note is optional */ }
          }
          return closed;
        })
      );
      const closedCount = results.filter((r) => r.status === "fulfilled" && r.value).length;
      if (closedCount > 0) {
        console.log(`[ActivityCache:${team}] ${closedCount}/${batch.length} leads DDD proibido fechados com sucesso`);
      }
    }
  }

  console.log(
    `[ActivityCache:${team}] ${leadsAbandonados48h.length} abandonados, ${leadsEmRisco7d.length} em risco, ${tarefasVencidas.length} tarefas vencidas, ${leadsDDDProibido.length} DDD proibido`
  );

  return {
    leadsAbandonados48h,
    leadsEmRisco7d,
    tarefasVencidas,
    leadsDDDProibido,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

export async function getActivityMetrics(
  team: string,
  service: KommoService,
  crmMetrics: CrmMetrics
): Promise<ActivityMetrics> {
  let entry = activityCaches.get(team);
  if (!entry) {
    entry = { metrics: null, expiresAt: 0, fetchPromise: null };
    activityCaches.set(team, entry);
  }
  const now = Date.now();

  if (entry.metrics && now < entry.expiresAt) return entry.metrics;

  if (entry.metrics && !entry.fetchPromise) {
    entry.fetchPromise = fetchActivity(team, service, crmMetrics)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + ACTIVITY_CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[ActivityCache:${team}] Erro no refresh:`, err);
        return entry.metrics!;
      })
      .finally(() => { entry.fetchPromise = null; });
    return entry.metrics;
  }

  if (!entry.fetchPromise) {
    entry.fetchPromise = fetchActivity(team, service, crmMetrics)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + ACTIVITY_CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[ActivityCache:${team}] Erro no fetch inicial:`, err);
        throw err;
      })
      .finally(() => { entry.fetchPromise = null; });
  }

  return entry.fetchPromise;
}
