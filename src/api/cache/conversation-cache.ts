import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { TeamKey } from "../../config.js";
import { getCrmMetrics, ActiveLead } from "./crm-cache.js";

export interface ConversationInsight {
  leadId: number;
  leadNome: string;
  vendedor: string;
  sentimentScore: number;
  qualityScore: number;
  resumo: string;
  pontosPositivos: string[];
  pontosMelhoria: string[];
  analisadoEm: string;
}

export interface AgentInsightSummary {
  nome: string;
  team: string;
  mediaSentimento: number;
  mediaQualidade: number;
  totalAnalisados: number;
  insights: ConversationInsight[];
}

interface InsightsCacheEntry {
  data: AgentInsightSummary[] | null;
  expiresAt: number;
  fetchPromise: Promise<AgentInsightSummary[]> | null;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CONVERSATIONS_PER_AGENT = 5;
const MAX_LEADS_SAMPLE = 30; // reduced from 50 to limit API calls
const CONCURRENCY = 5; // parallel notes/analysis workers

const caches: Record<TeamKey, InsightsCacheEntry> = {
  azul: { data: null, expiresAt: 0, fetchPromise: null },
  amarela: { data: null, expiresAt: 0, fetchPromise: null },
};

const ANALYSIS_PROMPT = `Voce e um analista de qualidade de atendimento comercial. Analise a conversa abaixo entre o vendedor e o lead/cliente.

Retorne EXATAMENTE neste formato JSON (sem markdown, sem code blocks):
{
  "sentimentScore": <1 a 5, onde 1=muito negativo, 5=muito positivo>,
  "qualityScore": <1 a 5, onde 1=atendimento ruim, 5=excelente>,
  "resumo": "<resumo de 1-2 frases da conversa>",
  "pontosPositivos": ["<ponto 1>", "<ponto 2>"],
  "pontosMelhoria": ["<ponto 1>", "<ponto 2>"]
}

Criterios de qualidade:
- Tempo de resposta implicito (gaps entre mensagens)
- Tom profissional e empatico
- Proatividade em oferecer solucoes
- Clareza na comunicacao
- Follow-up adequado

Conversa:
`;

async function analyzeConversation(
  genAI: GoogleGenerativeAI,
  leadNome: string,
  vendedor: string,
  notes: Array<{ text: string; created_at: number; note_type: string }>
): Promise<Omit<ConversationInsight, "leadId" | "leadNome" | "vendedor" | "analisadoEm"> | null> {
  if (notes.length === 0) return null;

  const conversationText = notes
    .filter((n) => n.text && n.text.trim().length > 0)
    .map((n) => {
      const date = new Date(n.created_at * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const tipo = n.note_type === "message_cashier" ? "Mensagem" : "Nota";
      return `[${date}] (${tipo}) ${n.text}`;
    })
    .join("\n");

  if (conversationText.trim().length < 20) return null;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(ANALYSIS_PROMPT + conversationText);
    const text = result.response.text().trim();

    const jsonStr = text.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(jsonStr);

    return {
      sentimentScore: Math.min(5, Math.max(1, parsed.sentimentScore || 3)),
      qualityScore: Math.min(5, Math.max(1, parsed.qualityScore || 3)),
      resumo: parsed.resumo || "Sem resumo disponivel",
      pontosPositivos: parsed.pontosPositivos || [],
      pontosMelhoria: parsed.pontosMelhoria || [],
    };
  } catch (err) {
    console.error(`[ConversationCache] Error analyzing lead "${leadNome}":`, err);
    return null;
  }
}

/**
 * Score leads for analysis priority.
 * Considers: deal value (price), recency (updated_at), and ensures diversity across agents.
 * Returns the top N leads sorted by score.
 */
function scoreAndSelectLeads(allLeads: ActiveLead[], maxLeads: number): ActiveLead[] {
  if (allLeads.length === 0) return [];

  const now = Date.now() / 1000;
  const maxPrice = Math.max(...allLeads.map((l) => l.price), 1);
  const maxAge = Math.max(...allLeads.map((l) => now - l.updatedAt), 1);

  // Score each lead: 40% price potential + 60% recency
  const scored = allLeads.map((lead) => {
    const priceScore = lead.price / maxPrice; // 0-1, higher price = higher
    const recencyScore = 1 - (now - lead.updatedAt) / maxAge; // 0-1, more recent = higher
    const score = priceScore * 0.4 + recencyScore * 0.6;
    return { lead, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Select top leads ensuring diversity across agents (max 8 per agent in the pool)
  const MAX_PER_AGENT = 8;
  const agentCounts = new Map<string, number>();
  const selected: ActiveLead[] = [];

  for (const { lead } of scored) {
    const agent = lead.responsibleUserName;
    const count = agentCounts.get(agent) || 0;
    if (count >= MAX_PER_AGENT) continue;
    agentCounts.set(agent, count + 1);
    selected.push(lead);
    if (selected.length >= maxLeads) break;
  }

  return selected;
}

/** Run async tasks with a concurrency limit */
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function fetchInsights(
  team: TeamKey,
  service: KommoService,
  genAI: GoogleGenerativeAI
): Promise<AgentInsightSummary[]> {
  console.log(`[ConversationCache:${team}] Fetching conversation insights...`);

  const metrics = await getCrmMetrics(team, service);

  // Score ALL active leads by price + recency, pick top leads
  const topLeads = scoreAndSelectLeads(metrics.activeLeads, MAX_LEADS_SAMPLE);
  console.log(`[ConversationCache:${team}] Selected ${topLeads.length} leads from ${metrics.activeLeads.length} active (scored by price + recency)`);

  // Group by agent
  const leadsByAgent = new Map<string, ActiveLead[]>();
  for (const lead of topLeads) {
    const agentName = lead.responsibleUserName;
    if (!leadsByAgent.has(agentName)) {
      leadsByAgent.set(agentName, []);
    }
    leadsByAgent.get(agentName)!.push(lead);
  }

  // Flatten all leads to analyze with their agent info
  const leadsToAnalyze: Array<{ lead: ActiveLead; agentName: string }> = [];
  for (const [agentName, leads] of leadsByAgent) {
    const sampled = leads.slice(0, MAX_CONVERSATIONS_PER_AGENT);
    for (const lead of sampled) {
      leadsToAnalyze.push({ lead, agentName });
    }
  }

  // Fetch notes + analyze in parallel with concurrency limit
  const insightResults = await parallelMap(
    leadsToAnalyze,
    CONCURRENCY,
    async ({ lead, agentName }): Promise<ConversationInsight | null> => {
      try {
        const notes = await service.getLeadNotesAll(lead.id);
        const messageNotes = notes.filter(
          (n) => (n.params?.text || n.text || "").trim().length > 0
        );
        if (messageNotes.length < 2) return null;

        const analysis = await analyzeConversation(
          genAI,
          lead.titulo,
          agentName,
          messageNotes.map((n) => ({
            text: n.params?.text || n.text || "",
            created_at: n.created_at,
            note_type: n.note_type,
          }))
        );

        if (!analysis) return null;
        return {
          leadId: lead.id,
          leadNome: lead.titulo,
          vendedor: agentName,
          ...analysis,
          analisadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        };
      } catch (err) {
        console.error(`[ConversationCache:${team}] Error processing lead ${lead.id}:`, err);
        return null;
      }
    }
  );

  // Group results back by agent
  const insightsByAgent = new Map<string, ConversationInsight[]>();
  for (const insight of insightResults) {
    if (!insight) continue;
    const arr = insightsByAgent.get(insight.vendedor) || [];
    arr.push(insight);
    insightsByAgent.set(insight.vendedor, arr);
  }

  const agentSummaries: AgentInsightSummary[] = [];
  for (const [agentName, insights] of insightsByAgent) {
    const avgSentiment = insights.reduce((s, i) => s + i.sentimentScore, 0) / insights.length;
    const avgQuality = insights.reduce((s, i) => s + i.qualityScore, 0) / insights.length;

    agentSummaries.push({
      nome: agentName,
      team,
      mediaSentimento: Math.round(avgSentiment * 10) / 10,
      mediaQualidade: Math.round(avgQuality * 10) / 10,
      totalAnalisados: insights.length,
      insights,
    });
  }

  agentSummaries.sort((a, b) => b.mediaQualidade - a.mediaQualidade);
  console.log(`[ConversationCache:${team}] Done — ${agentSummaries.length} agents analyzed`);
  return agentSummaries;
}

/**
 * Returns cached insights immediately if available.
 * On cold cache (first call), starts background processing and returns empty array
 * so the frontend doesn't hang waiting for Gemini to analyze all conversations.
 */
export async function getConversationInsights(
  team: TeamKey,
  service: KommoService,
  genAI: GoogleGenerativeAI
): Promise<{ data: AgentInsightSummary[]; processing: boolean }> {
  const entry = caches[team];
  const now = Date.now();

  // Cache hit — return immediately
  if (entry.data && now < entry.expiresAt) {
    return { data: entry.data, processing: false };
  }

  // Stale cache — return stale data and refresh in background
  if (entry.data && !entry.fetchPromise) {
    entry.fetchPromise = fetchInsights(team, service, genAI)
      .then((data) => {
        entry.data = data;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return data;
      })
      .catch((err) => {
        console.error(`[ConversationCache:${team}] Refresh error:`, err);
        return entry.data!;
      })
      .finally(() => { entry.fetchPromise = null; });
    return { data: entry.data, processing: true };
  }

  // Cold cache — start background fetch, return empty immediately
  if (!entry.fetchPromise) {
    entry.fetchPromise = fetchInsights(team, service, genAI)
      .then((data) => {
        entry.data = data;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return data;
      })
      .catch((err) => {
        console.error(`[ConversationCache:${team}] Initial fetch error:`, err);
        return [];
      })
      .finally(() => { entry.fetchPromise = null; });
  }

  return { data: [], processing: true };
}

/**
 * Clears cached insights for a specific team or all teams.
 * After clearing, next call to getConversationInsights will trigger a fresh fetch.
 */
export function clearInsightsCache(team?: TeamKey): void {
  const teams = team ? [team] : (Object.keys(caches) as TeamKey[]);
  for (const t of teams) {
    caches[t].data = null;
    caches[t].expiresAt = 0;
    caches[t].fetchPromise = null;
  }
  console.log(`[InsightsCache] Cache cleared for: ${teams.join(", ")}`);
}
