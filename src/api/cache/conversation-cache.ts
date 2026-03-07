import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { getCrmMetrics, ActiveLead, CrmMetrics } from "./crm-cache.js";

export interface ConversationInsight {
  leadId: number;
  leadNome: string;
  vendedor: string;
  kommoUrl: string;
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

// Per-lead insight cache — survives across requests, saves Gemini tokens
interface LeadInsightEntry {
  insight: ConversationInsight;
  noteCount: number;
  analyzedAt: number;
}
const leadInsightCache = new Map<number, LeadInsightEntry>();

const MAX_LEADS_SAMPLE = 30;
const CONCURRENCY = 5;
const MIN_NEW_ACTIONS = 5; // Only re-analyze if +5 new notes since last analysis

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
  _vendedor: string,
  notes: Array<{ text: string; created_at: number; note_type: string }>
): Promise<Omit<ConversationInsight, "leadId" | "leadNome" | "vendedor" | "kommoUrl" | "analisadoEm"> | null> {
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
 */
function scoreAndSelectLeads(allLeads: ActiveLead[], maxLeads: number): ActiveLead[] {
  if (allLeads.length === 0) return [];

  const now = Date.now() / 1000;
  const maxPrice = Math.max(...allLeads.map((l) => l.price), 1);
  const maxAge = Math.max(...allLeads.map((l) => now - l.updatedAt), 1);

  const scored = allLeads.map((lead) => {
    const priceScore = lead.price / maxPrice;
    const recencyScore = 1 - (now - lead.updatedAt) / maxAge;
    const score = priceScore * 0.4 + recencyScore * 0.6;
    return { lead, score };
  });

  scored.sort((a, b) => b.score - a.score);

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

export interface InsightsFilter {
  team?: string;
  funil?: string;
  agente?: string;
}

/**
 * Fetch insights for specific filters. Uses per-lead cache to minimize Gemini calls.
 * Only re-analyzes a lead if it has +5 new notes since last analysis.
 */
export async function fetchFilteredInsights(
  services: Record<TeamKey, KommoService>,
  genAI: GoogleGenerativeAI,
  userTeams: TeamKey[],
  filters: InsightsFilter
): Promise<{ data: AgentInsightSummary[]; processing: boolean }> {
  const targetTeams = filters.team
    ? userTeams.filter((t) => t === filters.team && !!services[t])
    : userTeams.filter((t) => !!services[t]);

  if (targetTeams.length === 0) return { data: [], processing: false };

  // Collect all active leads matching filters
  let allLeads: Array<{ lead: ActiveLead; team: TeamKey; metrics: CrmMetrics }> = [];

  for (const team of targetTeams) {
    const metrics = await getCrmMetrics(team, services[team]);
    let leads = metrics.activeLeads;

    // Filter by funil (pipeline name)
    if (filters.funil) {
      const pipelineIds = new Set<number>();
      for (const [id, name] of Object.entries(metrics.pipelineNames)) {
        const cleanName = name.replace(/^FUNIL\s+/i, "");
        if (cleanName === filters.funil) pipelineIds.add(Number(id));
      }
      leads = leads.filter((l) => pipelineIds.has(l.pipelineId));
    }

    // Filter by agente
    if (filters.agente) {
      leads = leads.filter((l) => l.responsibleUserName === filters.agente);
    }

    for (const lead of leads) {
      allLeads.push({ lead, team, metrics });
    }
  }

  // Score and select top 30
  const selectedLeads = scoreAndSelectLeads(
    allLeads.map((l) => l.lead),
    MAX_LEADS_SAMPLE
  );
  const selectedIds = new Set(selectedLeads.map((l) => l.id));
  const selectedWithTeam = allLeads.filter((l) => selectedIds.has(l.lead.id));

  console.log(`[Insights] Analyzing ${selectedWithTeam.length} leads (filtered from ${allLeads.length})`);

  // Analyze leads (using per-lead cache + 5-action rule)
  const insightResults = await parallelMap(
    selectedWithTeam,
    CONCURRENCY,
    async ({ lead, team }): Promise<ConversationInsight | null> => {
      const subdomain = TEAMS[team].subdomain;
      const kommoUrl = `https://${subdomain}.kommo.com/leads/detail/${lead.id}`;

      try {
        const notes = await services[team].getLeadNotesAll(lead.id);
        const messageNotes = notes.filter(
          (n) => (n.params?.text || n.text || "").trim().length > 0
        );
        if (messageNotes.length < 2) return null;

        const currentNoteCount = messageNotes.length;

        // Check per-lead cache: skip if <5 new notes since last analysis
        const cached = leadInsightCache.get(lead.id);
        if (cached && (currentNoteCount - cached.noteCount) < MIN_NEW_ACTIONS) {
          // Update kommoUrl in case team changed
          return { ...cached.insight, kommoUrl };
        }

        // Analyze with Gemini
        const analysis = await analyzeConversation(
          genAI,
          lead.titulo,
          lead.responsibleUserName,
          messageNotes.map((n) => ({
            text: n.params?.text || n.text || "",
            created_at: n.created_at,
            note_type: n.note_type,
          }))
        );

        if (!analysis) return null;

        const insight: ConversationInsight = {
          leadId: lead.id,
          leadNome: lead.titulo,
          vendedor: lead.responsibleUserName,
          kommoUrl,
          ...analysis,
          analisadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        };

        // Update per-lead cache
        leadInsightCache.set(lead.id, {
          insight,
          noteCount: currentNoteCount,
          analyzedAt: Date.now(),
        });

        return insight;
      } catch (err) {
        console.error(`[Insights] Error processing lead ${lead.id}:`, err);
        return null;
      }
    }
  );

  // Group by agent
  const insightsByAgent = new Map<string, ConversationInsight[]>();
  for (const insight of insightResults) {
    if (!insight) continue;
    const arr = insightsByAgent.get(insight.vendedor) || [];
    arr.push(insight);
    insightsByAgent.set(insight.vendedor, arr);
  }

  const agentSummaries: AgentInsightSummary[] = [];
  for (const [agentName, insights] of insightsByAgent) {
    const team = selectedWithTeam.find((l) => l.lead.responsibleUserName === agentName)?.team || targetTeams[0];
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
  console.log(`[Insights] Done — ${agentSummaries.length} agents`);
  return { data: agentSummaries, processing: false };
}

// Legacy functions for backwards compat (remove later)
export async function getConversationInsights(
  team: TeamKey,
  service: KommoService,
  genAI: GoogleGenerativeAI
): Promise<{ data: AgentInsightSummary[]; processing: boolean }> {
  return fetchFilteredInsights(
    { [team]: service } as Record<TeamKey, KommoService>,
    genAI,
    [team],
    { team }
  );
}

export function clearInsightsCache(_team?: TeamKey): void {
  // Per-lead cache doesn't need clearing — 5-action rule handles staleness
  console.log(`[InsightsCache] Cache invalidation requested (per-lead cache remains)`);
}
