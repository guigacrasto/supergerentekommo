import { CrmMetrics, LeadSnapshot, LeadTag } from "../cache/crm-cache.js";

interface FilterOptions {
  tags?: number[];
  tagMode?: "or" | "and";
  allowedFunnels?: number[];
  pausedPipelines?: number[];
  allowedGroups?: string[];
  isAdmin?: boolean;
}

export function filterCrmMetrics(metrics: CrmMetrics, opts: FilterOptions): CrmMetrics {
  const { tags, tagMode = "or", allowedFunnels = [], pausedPipelines = [], allowedGroups = [], isAdmin = false } = opts;

  // 1. Filter funis by allowedFunnels + pausedPipelines
  const filteredFunis: Record<string, any> = {};
  for (const [key, funil] of Object.entries(metrics.funis)) {
    const pipelineId = Number(key);
    if (pausedPipelines.includes(pipelineId)) continue;
    if (allowedFunnels.length > 0 && !allowedFunnels.includes(pipelineId)) continue;
    filteredFunis[key] = funil;
  }

  const allowedPipelineIds = new Set(Object.keys(filteredFunis).map(Number));

  // 2. Build allowed user IDs from group permissions
  const hasGroupRestriction = allowedGroups.length > 0;
  const allowedUserIds = new Set<number>();
  if (hasGroupRestriction) {
    for (const [userId, groupName] of Object.entries(metrics.userGroups)) {
      if (allowedGroups.includes(groupName)) {
        allowedUserIds.add(Number(userId));
      }
    }
  }

  // 3. Filter leadSnapshots by allowed pipelines + groups
  let filteredSnapshots = metrics.leadSnapshots.filter(
    (l) => allowedPipelineIds.has(l.pipeline_id)
  );
  if (hasGroupRestriction) {
    filteredSnapshots = filteredSnapshots.filter(
      (l) => allowedUserIds.has(l.responsible_user_id)
    );
  }

  // 4. Filter by tags
  if (tags && tags.length > 0) {
    filteredSnapshots = filteredSnapshots.filter((lead) => {
      const leadTagIds = lead.tags.map((t) => t.id);
      if (tagMode === "and") {
        return tags.every((tagId) => leadTagIds.includes(tagId));
      }
      return tags.some((tagId) => leadTagIds.includes(tagId));
    });
  }

  // 5. Filter vendedores by allowed pipelines + groups
  let filteredVendedores = metrics.vendedores.filter((v) => {
    return Object.values(filteredFunis).some((f: any) => f.nome === v.funil);
  });
  if (hasGroupRestriction) {
    filteredVendedores = filteredVendedores.filter((v) => {
      const uid = Object.entries(metrics.userNames).find(([, name]) => name === v.nome)?.[0];
      return uid ? allowedUserIds.has(Number(uid)) : false;
    });
  }

  // 6. Filter activeLeads
  const allowedLeadIds = new Set(filteredSnapshots.map((s) => s.id));
  const filteredActiveLeads = metrics.activeLeads.filter((l) => allowedLeadIds.has(l.id));

  // 7. Recalculate geral
  const STATUS_WON = 142;
  const STATUS_LOST = 143;
  const totalGanhos = filteredSnapshots.filter((l) => l.status_id === STATUS_WON).length;
  const totalPerdidos = filteredSnapshots.filter((l) => l.status_id === STATUS_LOST).length;

  function countPeriod(leads: LeadSnapshot[], days: number): number {
    const now = new Date();
    const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    brt.setHours(0, 0, 0, 0);
    brt.setDate(brt.getDate() - days + 1);
    const year = brt.getFullYear();
    const month = String(brt.getMonth() + 1).padStart(2, '0');
    const day = String(brt.getDate()).padStart(2, '0');
    const cutoff = new Date(`${year}-${month}-${day}T00:00:00-03:00`).getTime() / 1000;
    return leads.filter((l) => l.created_at >= cutoff).length;
  }

  function countCurrentMonth(leads: LeadSnapshot[]): number {
    const now = new Date();
    const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const year = brt.getFullYear();
    const month = String(brt.getMonth() + 1).padStart(2, '0');
    const cutoff = new Date(`${year}-${month}-01T00:00:00-03:00`).getTime() / 1000;
    return leads.filter((l) => l.created_at >= cutoff).length;
  }

  const geral = {
    total: filteredSnapshots.length,
    ganhos: totalGanhos,
    perdidos: totalPerdidos,
    ativos: filteredSnapshots.length - totalGanhos - totalPerdidos,
    conversao: filteredSnapshots.length > 0 ? ((totalGanhos / filteredSnapshots.length) * 100).toFixed(1) + "%" : "0.0%",
    novosHoje: countPeriod(filteredSnapshots, 1),
    novosSemana: countPeriod(filteredSnapshots, 7),
    novosMes: countCurrentMonth(filteredSnapshots),
  };

  // 8. Collect tags from filtered snapshots
  const tagMap = new Map<number, string>();
  for (const snap of filteredSnapshots) {
    for (const t of snap.tags) {
      if (!tagMap.has(t.id)) tagMap.set(t.id, t.name);
    }
  }
  const allTags: LeadTag[] = Array.from(tagMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 9. Filter userNames by group restrictions
  const filteredUserNames = hasGroupRestriction
    ? Object.fromEntries(Object.entries(metrics.userNames).filter(([id]) => allowedUserIds.has(Number(id))))
    : metrics.userNames;

  return {
    funis: filteredFunis,
    vendedores: filteredVendedores,
    geral,
    activeLeads: filteredActiveLeads,
    leadSnapshots: filteredSnapshots,
    pipelineNames: Object.fromEntries(
      Object.entries(metrics.pipelineNames).filter(([id]) => allowedPipelineIds.has(Number(id)))
    ),
    userNames: filteredUserNames,
    userGroups: metrics.userGroups,
    contactCfByLead: metrics.contactCfByLead,
    lossReasonNames: metrics.lossReasonNames,
    allTags,
    atualizadoEm: metrics.atualizadoEm,
  };
}

export function parseTagsFromQuery(query: any): { tags: number[]; tagMode: "or" | "and" } {
  let tags: number[] = [];
  if (typeof query.tags === "string" && query.tags.length > 0) {
    tags = query.tags.split(",").map(Number).filter((n: number) => !isNaN(n) && n > 0);
  }
  const tagMode = query.tagMode === "and" ? "and" : "or";
  return { tags, tagMode };
}
