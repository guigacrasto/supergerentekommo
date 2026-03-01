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
  atualizadoEm: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

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

function toConversao(ganhos: number, perdidos: number): string {
  const total = ganhos + perdidos;
  if (total === 0) return "0.0%";
  return ((ganhos / total) * 100).toFixed(1) + "%";
}

function countPeriod(leads: any[], days: number): number {
  const cutoff = Date.now() / 1000 - days * 86400;
  return leads.filter((l) => l.created_at >= cutoff).length;
}

function countWonPeriod(leads: any[], days: number): number {
  const cutoff = Date.now() / 1000 - days * 86400;
  return leads.filter((l) => l.status_id === STATUS.WON && l.closed_at >= cutoff).length;
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
      atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };
  }

  const [users, ...leadsPerPipeline] = await Promise.all([
    service.getUsers(),
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
      conversao: toConversao(ganhos, perdidos),
      novosHoje: countPeriod(leads, 1),
      novosSemana: countPeriod(leads, 7),
      novosMes: countPeriod(leads, 30),
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
        conversao: toConversao(ganhos, perdidos),
        novosSemana: countPeriod(mine, 7),
        novosMes: countPeriod(mine, 30),
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
    conversao: toConversao(totalGanhos, totalPerdidos),
    novosHoje: countPeriod(allLeads, 1),
    novosSemana: countPeriod(allLeads, 7),
    novosMes: countPeriod(allLeads, 30),
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
    }));

  console.log(`[CrmCache:${team}] Pronto — ${allLeads.length} leads, ${vendedores.length} entradas de vendedor`);

  return {
    funis,
    vendedores,
    geral,
    activeLeads,
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
