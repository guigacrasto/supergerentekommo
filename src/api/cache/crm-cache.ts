import { KommoService } from "../../services/kommo.js";

export interface VendedorMetrics {
  nome: string;
  funil: string;
  team: string;
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
  team: string;
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
  pipelineId: number;
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
  contactCfByLead: Record<number, any[]>;
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

// Cache keyed by "tenantId:team"
const caches = new Map<string, CacheEntry>();

function getOrCreateEntry(key: string): CacheEntry {
  let entry = caches.get(key);
  if (!entry) {
    entry = { metrics: null, expiresAt: 0, fetchPromise: null };
    caches.set(key, entry);
  }
  return entry;
}

export function invalidateAllCaches(): void {
  for (const [key, entry] of caches) {
    entry.expiresAt = 0;
    console.log(`[CrmCache:${key}] Cache invalidado`);
  }
}

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

async function fetchAndCompute(
  team: string,
  service: KommoService,
  excludeNames: string[] = []
): Promise<CrmMetrics> {
  console.log(`[CrmCache:${team}] Buscando dados do CRM...`);

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
      contactCfByLead: {},
      pipelineNames: {},
      userNames: {},
      userGroups: {},
      lossReasonNames: {},
      allTags: [],
      atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };
  }

  const [users, lossReasons, groups, contacts, ...leadsPerPipeline] = await Promise.all([
    service.getUsers(),
    service.getLossReasons(),
    service.getGroups(),
    service.getContacts(),
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
      pipelineId: l.pipeline_id ?? 0,
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

  // Build contact custom fields map: contactId → custom_fields_values
  const contactCfMap = new Map<number, any[]>();
  for (const c of contacts) {
    if (c.custom_fields_values && c.custom_fields_values.length > 0) {
      contactCfMap.set(c.id, c.custom_fields_values);
    }
  }

  // Build leadId → contact custom fields (from embedded contacts in lead response)
  const contactCfByLead: Record<number, any[]> = {};
  for (const l of allLeads) {
    const linkedContacts = l._embedded?.contacts ?? [];
    if (linkedContacts.length === 0) continue;
    const merged: any[] = [];
    for (const lc of linkedContacts) {
      const cf = contactCfMap.get(lc.id);
      if (cf) merged.push(...cf);
    }
    if (merged.length > 0) contactCfByLead[l.id] = merged;
  }
  console.log(`[CrmCache:${team}] Contatos: ${contacts.length}, leads com CF de contato: ${Object.keys(contactCfByLead).length}`);

  const pipelineNames: Record<number, string> = {};
  pipelines.forEach((p: any) => { pipelineNames[p.id] = p.name; });

  const userNamesMap: Record<number, string> = {};
  users.forEach((u: any) => { userNamesMap[u.id] = u.name; });

  // Build group name lookup
  const groupNamesMap: Record<number, string> = {};
  groups.forEach((g: { id: number; name: string }) => { groupNamesMap[g.id] = g.name; });

  // Collect unique group_ids from users (group_id is in user.rights.group_id)
  const uniqueGroupIds = new Set<number>();
  users.forEach((u: any) => {
    const gid = u.rights?.group_id ?? u.group_id;
    if (gid && gid !== 0) uniqueGroupIds.add(gid);
  });

  // If bulk /groups returned empty, try account endpoint and individual resolution
  if (groups.length === 0 && uniqueGroupIds.size > 0) {
    const accountInfo = await service.getAccountInfo();
    if (accountInfo) {
      const accountGroups = accountInfo?._embedded?.groups
        || accountInfo?._embedded?.users_groups
        || accountInfo?.groups
        || accountInfo?.users_groups
        || [];
      if (Array.isArray(accountGroups) && accountGroups.length > 0) {
        for (const g of accountGroups) {
          if (g.id && g.name) groupNamesMap[g.id] = g.name;
        }
        console.log(`[CrmCache:${team}] Groups from account: ${JSON.stringify(groupNamesMap)}`);
      } else {
        console.log(`[CrmCache:${team}] Account keys: ${JSON.stringify(Object.keys(accountInfo))}`);
        if (accountInfo._embedded) {
          console.log(`[CrmCache:${team}] Account _embedded keys: ${JSON.stringify(Object.keys(accountInfo._embedded))}`);
        }
      }
    }

    if (Object.keys(groupNamesMap).length === 0) {
      console.log(`[CrmCache:${team}] Resolving ${uniqueGroupIds.size} groups by ID: ${[...uniqueGroupIds]}`);
      const resolved = await Promise.all(
        [...uniqueGroupIds].map((gid) => service.getGroupById(gid))
      );
      for (const g of resolved) {
        if (g) groupNamesMap[g.id] = g.name;
      }
    }
  }
  console.log(`[CrmCache:${team}] Group names resolved: ${JSON.stringify(groupNamesMap)}`);

  // Map users to their group names (group_id is in rights object)
  const userGroupsMap: Record<number, string> = {};
  users.forEach((u: any) => {
    const gid = u.rights?.group_id ?? u.group_id;
    if (gid && groupNamesMap[gid]) {
      userGroupsMap[u.id] = groupNamesMap[gid];
    }
  });
  console.log(`[CrmCache:${team}] User groups mapped: ${Object.keys(userGroupsMap).length} users`);

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
    contactCfByLead,
    pipelineNames,
    userNames: userNamesMap,
    userGroups: userGroupsMap,
    lossReasonNames: lossReasonNamesMap,
    allTags,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

export async function getCrmMetrics(
  team: string,
  service: KommoService,
  tenantId?: string,
  excludeNames: string[] = []
): Promise<CrmMetrics> {
  const cacheKey = tenantId ? `${tenantId}:${team}` : team;
  const entry = getOrCreateEntry(cacheKey);
  const now = Date.now();

  if (entry.metrics && now < entry.expiresAt) return entry.metrics;

  if (entry.metrics && !entry.fetchPromise) {
    entry.fetchPromise = fetchAndCompute(team, service, excludeNames)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${cacheKey}] Erro no refresh:`, err);
        return entry.metrics!;
      })
      .finally(() => { entry.fetchPromise = null; });
    return entry.metrics;
  }

  if (!entry.fetchPromise) {
    entry.fetchPromise = fetchAndCompute(team, service, excludeNames)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${cacheKey}] Erro no fetch inicial:`, err);
        throw err;
      })
      .finally(() => { entry.fetchPromise = null; });
  }

  return entry.fetchPromise;
}

// Proactive background refresh — keeps cache always warm so no user ever waits
const PROACTIVE_REFRESH_MS = 4 * 60 * 1000; // 4 min (before 5 min TTL expires)
const registeredTeams: Array<{ cacheKey: string; team: string; service: KommoService; excludeNames: string[] }> = [];

export function startProactiveRefresh(
  team: string,
  service: KommoService,
  tenantId?: string,
  excludeNames: string[] = []
): void {
  const cacheKey = tenantId ? `${tenantId}:${team}` : team;
  registeredTeams.push({ cacheKey, team, service, excludeNames });
}

// Single interval refreshes all registered teams
setInterval(async () => {
  for (const { cacheKey, team, service, excludeNames } of registeredTeams) {
    const entry = getOrCreateEntry(cacheKey);
    if (entry.fetchPromise) continue; // already refreshing
    console.log(`[CrmCache:${cacheKey}] Proactive refresh...`);
    entry.fetchPromise = fetchAndCompute(team, service, excludeNames)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        console.log(`[CrmCache:${cacheKey}] Proactive refresh OK`);
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${cacheKey}] Proactive refresh error:`, err.message);
        return entry.metrics!;
      })
      .finally(() => { entry.fetchPromise = null; });
  }
}, PROACTIVE_REFRESH_MS);
