import { CrmMetrics, LeadSnapshot, LeadTag } from "../cache/crm-cache.js";

interface FilterOptions {
  tags?: number[];
  tagMode?: "or" | "and";
  allowedFunnels?: number[];
  pausedPipelines?: number[];
  isAdmin?: boolean;
}

export function filterCrmMetrics(metrics: CrmMetrics, opts: FilterOptions): CrmMetrics {
  const { tags, tagMode = "or", allowedFunnels = [], pausedPipelines = [], isAdmin = false } = opts;

  // 1. Filter funis by allowedFunnels + pausedPipelines
  const filteredFunis: Record<string, any> = {};
  for (const [key, funil] of Object.entries(metrics.funis)) {
    const pipelineId = Number(key);
    if (!isAdmin && pausedPipelines.includes(pipelineId)) continue;
    if (allowedFunnels.length > 0 && !allowedFunnels.includes(pipelineId)) continue;
    filteredFunis[key] = funil;
  }

  const allowedPipelineIds = new Set(Object.keys(filteredFunis).map(Number));

  // 2. Filter leadSnapshots by allowed pipelines
  let filteredSnapshots = metrics.leadSnapshots.filter(
    (l) => allowedPipelineIds.has(l.pipeline_id)
  );

  // 3. Filter by tags
  if (tags && tags.length > 0) {
    filteredSnapshots = filteredSnapshots.filter((lead) => {
      const leadTagIds = lead.tags.map((t) => t.id);
      if (tagMode === "and") {
        return tags.every((tagId) => leadTagIds.includes(tagId));
      }
      return tags.some((tagId) => leadTagIds.includes(tagId));
    });
  }

  // 4. Filter vendedores by allowed pipelines
  const filteredVendedores = metrics.vendedores.filter((v) => {
    return Object.values(filteredFunis).some((f: any) => f.nome === v.funil);
  });

  // 5. Filter activeLeads
  const allowedLeadIds = new Set(filteredSnapshots.map((s) => s.id));
  const filteredActiveLeads = metrics.activeLeads.filter((l) => allowedLeadIds.has(l.id));

  // 6. Recalculate geral
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

  const geral = {
    total: filteredSnapshots.length,
    ganhos: totalGanhos,
    perdidos: totalPerdidos,
    ativos: filteredSnapshots.length - totalGanhos - totalPerdidos,
    conversao: filteredSnapshots.length > 0 ? ((totalGanhos / filteredSnapshots.length) * 100).toFixed(1) + "%" : "0.0%",
    novosHoje: countPeriod(filteredSnapshots, 1),
    novosSemana: countPeriod(filteredSnapshots, 7),
    novosMes: countPeriod(filteredSnapshots, 30),
  };

  // 7. Collect tags from filtered snapshots
  const tagMap = new Map<number, string>();
  for (const snap of filteredSnapshots) {
    for (const t of snap.tags) {
      if (!tagMap.has(t.id)) tagMap.set(t.id, t.name);
    }
  }
  const allTags: LeadTag[] = Array.from(tagMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    funis: filteredFunis,
    vendedores: filteredVendedores,
    geral,
    activeLeads: filteredActiveLeads,
    leadSnapshots: filteredSnapshots,
    pipelineNames: Object.fromEntries(
      Object.entries(metrics.pipelineNames).filter(([id]) => allowedPipelineIds.has(Number(id)))
    ),
    userNames: metrics.userNames,
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
