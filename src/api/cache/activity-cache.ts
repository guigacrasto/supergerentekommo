import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { CrmMetrics } from "./crm-cache.js";

export interface AlertLead {
  id: number;
  nome: string;
  vendedor: string;
  diasSemAtividade: number;
  updatedAt: number;
  kommoUrl: string;
}

export interface AlertTask {
  id: number;
  texto: string;
  vendedor: string;
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
  atualizadoEm: string;
}

const ACTIVITY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

interface ActivityCacheEntry {
  metrics: ActivityMetrics | null;
  expiresAt: number;
  fetchPromise: Promise<ActivityMetrics> | null;
}

const activityCaches: Record<TeamKey, ActivityCacheEntry> = {
  azul: { metrics: null, expiresAt: 0, fetchPromise: null },
  amarela: { metrics: null, expiresAt: 0, fetchPromise: null },
};

async function fetchActivity(
  team: TeamKey,
  service: KommoService,
  crmMetrics: CrmMetrics
): Promise<ActivityMetrics> {
  console.log(`[ActivityCache:${team}] Buscando dados de atividade...`);

  const subdomain = TEAMS[team].subdomain;
  const now = Math.floor(Date.now() / 1000);
  const cutoff48h = now - 48 * 3600;
  const cutoff7d = now - 7 * 24 * 3600;

  const activeLeads = crmMetrics.activeLeads;

  // Leads without activity in last 48h but less than 7 days (warning tier)
  const leadsAbandonados48h: AlertLead[] = activeLeads
    .filter((l) => l.updatedAt < cutoff48h && l.updatedAt >= cutoff7d)
    .map((l) => ({
      id: l.id,
      nome: l.titulo,
      vendedor: l.responsibleUserName,
      diasSemAtividade: Math.floor((now - l.updatedAt) / 86400),
      updatedAt: l.updatedAt,
      kommoUrl: `https://${subdomain}.kommo.com/leads/detail/${l.id}`,
    }))
    .sort((a, b) => b.diasSemAtividade - a.diasSemAtividade);

  // Leads without activity for 7+ days (critical tier)
  const leadsEmRisco7d: AlertLead[] = activeLeads
    .filter((l) => l.updatedAt < cutoff7d)
    .map((l) => ({
      id: l.id,
      nome: l.titulo,
      vendedor: l.responsibleUserName,
      diasSemAtividade: Math.floor((now - l.updatedAt) / 86400),
      updatedAt: l.updatedAt,
      kommoUrl: `https://${subdomain}.kommo.com/leads/detail/${l.id}`,
    }))
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
    const userNameMap = new Map<number, string>(
      activeLeads.map((l) => [l.responsibleUserId, l.responsibleUserName])
    );

    tarefasVencidas = tasks
      .filter((t) => typeof t.complete_till === 'number' && t.complete_till > 0 && t.complete_till < now)
      .map((t) => ({
        id: t.id,
        texto: t.text || "Tarefa",
        vendedor: userNameMap.get(t.responsible_user_id) || `User ${t.responsible_user_id}`,
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

  console.log(
    `[ActivityCache:${team}] ${leadsAbandonados48h.length} abandonados, ${leadsEmRisco7d.length} em risco, ${tarefasVencidas.length} tarefas vencidas`
  );

  return {
    leadsAbandonados48h,
    leadsEmRisco7d,
    tarefasVencidas,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

export async function getActivityMetrics(
  team: TeamKey,
  service: KommoService,
  crmMetrics: CrmMetrics
): Promise<ActivityMetrics> {
  const entry = activityCaches[team];
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
