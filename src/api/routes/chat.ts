import { Router } from "express";
import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { getCrmMetrics, CrmMetrics } from "../cache/crm-cache.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";
import { TeamKey, TEAMS } from "../../config.js";
import { getActivityMetrics, ActivityMetrics } from "../cache/activity-cache.js";

interface ChatSession {
  history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, ChatSession>();

function buildSystemPrompt(
  allMetrics: Array<{ team: string; label: string; metrics: CrmMetrics }>,
  allActivity: Array<{ team: string; activity: ActivityMetrics }>
): string {
  const activityMap = new Map(allActivity.map((a) => [a.team, a.activity]));

  const sections = allMetrics.map(({ team, label, metrics }) => {
    const { funis, vendedores, geral } = metrics;
    const activity = activityMap.get(team);

    const funisTexto = Object.values(funis)
      .map(
        (f) =>
          `  ${f.nome}: ${f.total} leads | ganhos: ${f.ganhos} | perdidos: ${f.perdidos} | ativos: ${f.ativos} | conversão: ${f.conversao} | novos hoje: ${f.novosHoje} | novos semana: ${f.novosSemana} | novos mês: ${f.novosMes}`
      )
      .join("\n");

    const vendedoresTexto = vendedores
      .map(
        (v) =>
          `  ${v.nome} | ${v.funil} | total: ${v.total} | ganhos: ${v.ganhos} | perdidos: ${v.perdidos} | ativos: ${v.ativos} | conversão: ${v.conversao} | novos semana: ${v.novosSemana} | novos mês: ${v.novosMes}`
      )
      .join("\n");

    let activityTexto = "";
    if (activity) {
      const ab = activity.leadsAbandonados48h;
      const risco = activity.leadsEmRisco7d;
      const tarefas = activity.tarefasVencidas;
      activityTexto = `
ALERTAS DE ATIVIDADE (${activity.atualizadoEm}):
  Leads sem atividade há +48h: ${ab.length}${ab.length > 0 ? " — " + ab.slice(0, 5).map((l) => `${l.nome} (${l.vendedor}, ${l.diasSemAtividade}d)`).join(", ") + (ab.length > 5 ? ` e mais ${ab.length - 5}` : "") : ""}
  Leads em risco (sem atividade +7d): ${risco.length}${risco.length > 0 ? " — " + risco.slice(0, 5).map((l) => `${l.nome} (${l.vendedor}, ${l.diasSemAtividade}d)`).join(", ") + (risco.length > 5 ? ` e mais ${risco.length - 5}` : "") : ""}
  Tarefas vencidas: ${tarefas.length}${tarefas.length > 0 ? " — " + tarefas.slice(0, 5).map((t) => `${t.texto} (${t.vendedor}, ${t.diasVencida}d vencida)`).join(", ") + (tarefas.length > 5 ? ` e mais ${tarefas.length - 5}` : "") : ""}`;
    }

    return `## ${label.toUpperCase()} — ATUALIZADO EM: ${metrics.atualizadoEm}

RESUMO GERAL: ${geral.total} leads | ganhos: ${geral.ganhos} | perdidos: ${geral.perdidos} | ativos: ${geral.ativos} | conversão: ${geral.conversao} | novos hoje: ${geral.novosHoje}

MÉTRICAS POR FUNIL:
${funisTexto}

MÉTRICAS POR VENDEDOR × FUNIL:
${vendedoresTexto}
${activityTexto}`;
  });

  return `Você é o assistente analítico de CRM da empresa. Responda gerentes com precisão, profissionalismo e análise aprofundada.

${sections.join("\n\n---\n\n")}

## REGRAS GERAIS
- Responda SEMPRE em Português Brasil.
- Use Markdown (tabelas, negrito, listas) para formatar respostas.
- Baseie suas respostas EXCLUSIVAMENTE nos dados acima.
- Se não tiver o dado solicitado, informe claramente que não está disponível.
- Para rankings, ordene do maior para o menor.
- Conversão = ganhos ÷ (ganhos + perdidos) × 100.

## MODO ANALÍTICO — SEMPRE APLIQUE
- Ao analisar performance, identifique os **TOP 3 INSIGHTS** mais relevantes antes de responder.
- Faça **COMPARATIVOS** sempre que possível: funil A vs. B, agente X vs. média, esta semana vs. mês.
- Identifique **ANOMALIAS**: agentes muito acima ou abaixo da média, funis com conversão muito baixa.
- Conclua análises com uma **RECOMENDAÇÃO DE AÇÃO** clara e objetiva.
- Para perguntas sobre acompanhamento: use os dados de ALERTAS DE ATIVIDADE acima.
- Use tom executivo: direto, baseado em dados, orientado a resultado.

## FORMATAÇÃO OBRIGATÓRIA
- Use emojis para organizar seções: 📊 para dados/tabelas, 💡 para insights, ⚠️ para anomalias, ✅ para recomendações, 🏆 para rankings, 📋 para resumos
- Sempre que houver métricas numéricas, use tabela Markdown: | coluna | valor |
- Separe seções com linha horizontal: ---
- Máximo 3 bullet points por seção — seja conciso
- Nunca escreva parágrafos longos sem estrutura visual`;
}

export function chatRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  router.post("/", async (req: AuthRequest, res) => {
    const { message, sessionId: incomingSessionId } = req.body;

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "SUA_CHAVE_AQUI") {
      return res.json({
        response: "Ops! Eu preciso de uma GEMINI_API_KEY no arquivo .env para funcionar.",
      });
    }

    try {
      // Fetch metrics for all user's authorized teams
      const userTeams = (req as AuthRequest).userTeams || [];
      const metricsPerTeam = await Promise.all(
        userTeams
          .filter((t) => services[t])
          .map(async (t) => {
            const crmMetrics = await getCrmMetrics(t, services[t]);
            const activity = await getActivityMetrics(t, services[t], crmMetrics);
            return { team: t, label: TEAMS[t].label, crmMetrics, activity };
          })
      );
      const allMetrics = metricsPerTeam.map((m) => ({
        team: m.team,
        label: m.label,
        metrics: m.crmMetrics,
      }));
      const allActivity = metricsPerTeam.map((m) => ({
        team: m.team,
        activity: m.activity,
      }));
      const systemPrompt = buildSystemPrompt(allMetrics, allActivity);

      const sessionId = incomingSessionId || randomUUID();
      const now = Date.now();

      for (const [id, session] of sessions.entries()) {
        if (now - session.lastActivity > SESSION_TTL_MS) sessions.delete(id);
      }

      const session: ChatSession = sessions.get(sessionId) ?? { history: [], lastActivity: now };

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: systemPrompt,
      });

      const chat = model.startChat({
        history: session.history,
      });

      const result = await chat.sendMessage(message);
      const responseText = result.response.text();

        // Log token usage
        const usage = result.response.usageMetadata;
        if (usage && req.userId) {
          await supabase.from("token_logs").insert({
            user_id: req.userId,
            session_id: sessionId,
            prompt_tokens: usage.promptTokenCount ?? 0,
            completion_tokens: usage.candidatesTokenCount ?? 0,
            total_tokens: usage.totalTokenCount ?? 0,
          }).then(({ error }) => {
            if (error) console.error("[TokenLog] Erro ao salvar tokens:", error.message);
          });
        }

      session.history.push(
        { role: "user", parts: [{ text: message }] },
        { role: "model", parts: [{ text: responseText }] }
      );
      session.lastActivity = now;
      sessions.set(sessionId, session);

      res.json({ response: responseText, sessionId });
    } catch (error: any) {
      console.error("Erro Gemini:", error);
      res.status(500).json({ response: "Erro ao consultar o Gemini.", error: error.message });
    }
  });

  return router;
}
