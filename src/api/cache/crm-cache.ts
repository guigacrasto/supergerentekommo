import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";

export interface VendedorMetrics {
  nome: string;
  funil: string;
  team: TeamKey;
  total: number;
  ganhos: number;
  ganhosHoje: number;
  ganhosSemana: number;
  perdidos: number;
  ativos: number;
  conversao: string;
  novosSemana: number;
  novosMes: number;
}

export interface FunilMetrics {
  nome: string;
  team: TeamKey;
  total: number;
  ganhos: number;
  perdidos: number;
  ativos: number;
  conversao: string;
  novosHoje: number;
  novosSemana: number;
  novosMes: number;
}

export interface ActiveLead {
  id: number;
  titulo: string;
  responsibleUserId: number;
  responsibleUserName: string;
  updatedAt: number; // Unix timestamp (seconds)
  price: number; // Deal value (potential)
}

export interface LeadTag {
  id: number;
  name: string;
}

export interface LeadSnapshot {
  id: number;
  created_at: number;
  closed_at: number;
  status_id: number;
  pipeline_id: number;
  responsible_user_id: number;
  price: number;
  loss_reason_id: number;
  tags: LeadTag[];
  custom_fields_values: any[] | null;
}

export interface CrmMetrics {
  funis: Record<string, FunilMetrics>;
  vendedores: VendedorMetrics[];
  geral: {
    total: number;
    ganhos: number;
    perdidos: number;
    ativos: number;
    conversao: string;
    novosHoje: number;
    novosSemana: number;
    novosMes: number;
  };
  activeLeads: ActiveLead[];
  leadSnapshots: LeadSnapshot[];
  pipelineNames: Record<number, string>;
  userNames: Record<number, string>;
  userGroups: Record<number, string>;
  lossReasonNames: Record<number, string>;
  allTags: LeadTag[];
  atualizadoEm: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — dados sempre frescos

const STATUS = { WON: 142, LOST: 143 };

interface CacheEntry {
  metrics: CrmMetrics | null;
  expiresAt: number;
  fetchPromise: Promise<CrmMetrics> | null;
}

const caches: Record<TeamKey, CacheEntry> = {
  azul: { metrics: null, expiresAt: 0, fetchPromise: null },
  amarela: { metrics: null, expiresAt: 0, fetchPromise: null },
};

function toConversao(ganhos: number, total: number): string {
  if (total === 0) return "0.0%";
  return ((ganhos / total) * 100).toFixed(1) + "%";
}

function getBrtDayStart(daysAgo: number): number {
  const now = new Date();
  const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  brt.setHours(0, 0, 0, 0);
  brt.setDate(brt.getDate() - daysAgo + 1);
  const year = brt.getFullYear();
  const month = String(brt.getMonth() + 1).padStart(2, '0');
  const day = String(brt.getDate()).padStart(2, '0');
  return new Date(`${year}-${month}-${day}T00:00:00-03:00`).getTime() / 1000;
}

function countPeriod(leads: any[], days: number): number {
  const cutoff = getBrtDayStart(days);
  return leads.filter((l) => l.created_at >= cutoff).length;
}

function countWonPeriod(leads: any[], days: number): number {
  const cutoff = getBrtDayStart(days);
  return leads.filter((l) => l.status_id === STATUS.WON && l.closed_at >= cutoff).length;
}

function getBrtMonthStart(): number {
  const now = new Date();
  const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const year = brt.getFullYear();
  const month = String(brt.getMonth() + 1).padStart(2, '0');
  return new Date(`${year}-${month}-01T00:00:00-03:00`).getTime() / 1000;
}

function countCurrentMonth(leads: any[]): number {
  const cutoff = getBrtMonthStart();
  return leads.filter((l) => l.created_at >= cutoff).length;
}

async function fetchAndCompute(team: TeamKey, service: KommoService): Promise<CrmMetrics> {
  console.log(`[CrmCache:${team}] Buscando dados do CRM...`);

  const excludeNames = TEAMS[team].excludePipelineNames;

  // Fetch all pipelines dynamically
  const allPipelines = await service.getPipelines();
  const pipelines = allPipelines.filter(
    (p: any) => !excludeNames.some((ex) => p.name.toUpperCase().includes(ex.toUpperCase()))
  );

  if (pipelines.length === 0) {
    console.warn(`[CrmCache:${team}] Nenhum pipeline encontrado após filtro`);
    return {
      funis: {},
      vendedores: [],
      geral: { total: 0, ganhos: 0, perdidos: 0, ativos: 0, conversao: "0.0%", novosHoje: 0, novosSemana: 0, novosMes: 0 },
      activeLeads: [],
      leadSnapshots: [],
      pipelineNames: {},
      userNames: {},
      userGroups: {},
      lossReasonNames: {},
      allTags: [],
      atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };
  }

  const [users, lossReasons, groups, ...leadsPerPipeline] = await Promise.all([
    service.getUsers(),
    service.getLossReasons(),
    service.getGroups(),
    ...pipelines.map((p: any) => service.getLeads({ filter: { pipeline_id: p.id } })),
  ]);

  const leadsPerFunil: Record<string, { nome: string; leads: any[] }> = {};
  pipelines.forEach((p: any, i: number) => {
    leadsPerFunil[String(p.id)] = { nome: p.name, leads: leadsPerPipeline[i] };
  });

  const allLeads = leadsPerPipeline.flat();

  // Métricas por funil
  const funis: Record<string, FunilMetrics> = {};
  for (const [key, { nome, leads }] of Object.entries(leadsPerFunil)) {
    const ganhos = leads.filter((l) => l.status_id === STATUS.WON).length;
    const perdidos = leads.filter((l) => l.status_id === STATUS.LOST).length;
    const ativos = leads.length - ganhos - perdidos;
    funis[key] = {
      nome,
      team,
      total: leads.length,
      ganhos,
      perdidos,
      ativos,
      conversao: toConversao(ganhos, leads.length),
      novosHoje: countPeriod(leads, 1),
      novosSemana: countPeriod(leads, 7),
      novosMes: countCurrentMonth(leads),
    };
  }

  // Métricas por vendedor × funil
  const vendedores: VendedorMetrics[] = [];
  for (const user of users) {
    for (const [, { nome, leads }] of Object.entries(leadsPerFunil)) {
      const mine = leads.filter((l) => l.responsible_user_id === user.id);
      if (mine.length === 0) continue;
      const ganhos = mine.filter((l) => l.status_id === STATUS.WON).length;
      const perdidos = mine.filter((l) => l.status_id === STATUS.LOST).length;
      vendedores.push({
        nome: user.name,
        funil: nome,
        team,
        total: mine.length,
        ganhos,
        ganhosHoje: countWonPeriod(mine, 1),
        ganhosSemana: countWonPeriod(mine, 7),
        perdidos,
        ativos: mine.length - ganhos - perdidos,
        conversao: toConversao(ganhos, mine.length),
        novosSemana: countPeriod(mine, 7),
        novosMes: countCurrentMonth(mine),
      });
    }
  }

  const totalGanhos = allLeads.filter((l) => l.status_id === STATUS.WON).length;
  const totalPerdidos = allLeads.filter((l) => l.status_id === STATUS.LOST).length;

  const geral = {
    total: allLeads.length,
    ganhos: totalGanhos,
    perdidos: totalPerdidos,
    ativos: allLeads.length - totalGanhos - totalPerdidos,
    conversao: toConversao(totalGanhos, allLeads.length),
    novosHoje: countPeriod(allLeads, 1),
    novosSemana: countPeriod(allLeads, 7),
    novosMes: countCurrentMonth(allLeads),
  };

  const userMap = new Map<number, string>(users.map((u: any) => [u.id, u.name]));
  const activeLeads: ActiveLead[] = allLeads
    .filter((l) => l.status_id !== STATUS.WON && l.status_id !== STATUS.LOST)
    .map((l) => ({
      id: l.id,
      titulo: l.name || `Lead ${l.id}`,
      responsibleUserId: l.responsible_user_id,
      responsibleUserName: userMap.get(l.responsible_user_id) || "Desconhecido",
      updatedAt: l.updated_at ?? 0,
      price: l.price ?? 0,
    }));

  const leadSnapshots: LeadSnapshot[] = allLeads.map((l) => ({
    id: l.id,
    created_at: l.created_at ?? 0,
    closed_at: l.closed_at ?? 0,
    status_id: l.status_id ?? 0,
    pipeline_id: l.pipeline_id ?? 0,
    responsible_user_id: l.responsible_user_id ?? 0,
    price: l.price ?? 0,
    loss_reason_id: l.loss_reason_id ?? 0,
    tags: l._embedded?.tags?.map((t: any) => ({ id: t.id, name: t.name })) ?? [],
    custom_fields_values: l.custom_fields_values ?? null,
  }));

  const pipelineNames: Record<number, string> = {};
  pipelines.forEach((p: any) => { pipelineNames[p.id] = p.name; });

  const userNamesMap: Record<number, string> = {};
  users.forEach((u: any) => { userNamesMap[u.id] = u.name; });

  // Build group name lookup
  const groupNamesMap: Record<number, string> = {};
  groups.forEach((g: { id: number; name: string }) => { groupNamesMap[g.id] = g.name; });
  console.log(`[CrmCache:${team}] Groups from API: ${JSON.stringify(groups)}`);
  console.log(`[CrmCache:${team}] Users group_ids: ${JSON.stringify(users.slice(0, 5).map((u: any) => ({ id: u.id, name: u.name, group_id: u.group_id })))}`);

  // Map users to their group names
  const userGroupsMap: Record<number, string> = {};
  users.forEach((u: any) => {
    if (u.group_id && groupNamesMap[u.group_id]) {
      userGroupsMap[u.id] = groupNamesMap[u.group_id];
    }
  });
  console.log(`[CrmCache:${team}] User groups mapped: ${JSON.stringify(userGroupsMap)}`);

  const lossReasonNamesMap: Record<number, string> = {};
  lossReasons.forEach((r: { id: number; name: string }) => { lossReasonNamesMap[r.id] = r.name; });

  // Coletar todas as tags únicas
  const tagMap = new Map<number, string>();
  for (const snap of leadSnapshots) {
    for (const t of snap.tags) {
      if (!tagMap.has(t.id)) tagMap.set(t.id, t.name);
    }
  }
  const allTags: LeadTag[] = Array.from(tagMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  console.log(`[CrmCache:${team}] Pronto — ${allLeads.length} leads, ${vendedores.length} entradas de vendedor, ${allTags.length} tags`);

  return {
    funis,
    vendedores,
    geral,
    activeLeads,
    leadSnapshots,
    pipelineNames,
    userNames: userNamesMap,
    userGroups: userGroupsMap,
    lossReasonNames: lossReasonNamesMap,
    allTags,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

export async function getCrmMetrics(team: TeamKey, service: KommoService): Promise<CrmMetrics> {
  const entry = caches[team];
  const now = Date.now();

  if (entry.metrics && now < entry.expiresAt) return entry.metrics;

  if (entry.metrics && !entry.fetchPromise) {
    entry.fetchPromise = fetchAndCompute(team, service)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${team}] Erro no refresh:`, err);
        return entry.metrics!;
      })
      .finally(() => { entry.fetchPromise = null; });
    return entry.metrics;
  }

  if (!entry.fetchPromise) {
    entry.fetchPromise = fetchAndCompute(team, service)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${team}] Erro no fetch inicial:`, err);
        throw err;
      })
      .finally(() => { entry.fetchPromise = null; });
  }

  return entry.fetchPromise;
}

// Proactive background refresh — keeps cache always warm so no user ever waits
const PROACTIVE_REFRESH_MS = 4 * 60 * 1000; // 4 min (before 5 min TTL expires)
const registeredTeams: Array<{ team: TeamKey; service: KommoService }> = [];

export function startProactiveRefresh(team: TeamKey, service: KommoService): void {
  registeredTeams.push({ team, service });
}

// Single interval refreshes all registered teams
setInterval(async () => {
  for (const { team, service } of registeredTeams) {
    const entry = caches[team];
    if (entry.fetchPromise) continue; // already refreshing
    console.log(`[CrmCache:${team}] Proactive refresh...`);
    entry.fetchPromise = fetchAndCompute(team, service)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        console.log(`[CrmCache:${team}] Proactive refresh OK`);
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${team}] Proactive refresh error:`, err.message);
        return entry.metrics!;
      })
      .finally(() => { entry.fetchPromise = null; });
  }
}, PROACTIVE_REFRESH_MS);
