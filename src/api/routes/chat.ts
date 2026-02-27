import { Router } from "express";
import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { getCrmMetrics, CrmMetrics } from "../cache/crm-cache.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";
import { TeamKey, TEAMS } from "../../config.js";

interface ChatSession {
  history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, ChatSession>();

function buildSystemPrompt(allMetrics: Array<{ team: string; label: string; metrics: CrmMetrics }>): string {
  const sections = allMetrics.map(({ label, metrics }) => {
    const { funis, vendedores, geral } = metrics;

    const funisTexto = Object.values(funis)
      .map(
        (f) =>
          `  ${f.nome}: ${f.total} leads | ganhos: ${f.ganhos} | perdidos: ${f.perdidos} | ativos: ${f.ativos} | conversão: ${f.conversao} | novos semana: ${f.novosSemana} | novos mês: ${f.novosMes}`
      )
      .join("\n");

    const vendedoresTexto = vendedores
      .map(
        (v) =>
          `  ${v.nome} | ${v.funil} | total: ${v.total} | ganhos: ${v.ganhos} | perdidos: ${v.perdidos} | ativos: ${v.ativos} | conversão: ${v.conversao} | novos semana: ${v.novosSemana} | novos mês: ${v.novosMes}`
      )
      .join("\n");

    return `## ${label.toUpperCase()} — ATUALIZADO EM: ${metrics.atualizadoEm}

RESUMO GERAL: ${geral.total} leads | ganhos: ${geral.ganhos} | perdidos: ${geral.perdidos} | ativos: ${geral.ativos} | conversão: ${geral.conversao} | novos hoje: ${geral.novosHoje}

MÉTRICAS POR FUNIL:
${funisTexto}

MÉTRICAS POR VENDEDOR × FUNIL:
${vendedoresTexto}`;
  });

  return `Você é o assistente inteligente do Kommo CRM da empresa.
Responda perguntas de gerentes com precisão, profissionalismo e análise aprofundada.

${sections.join("\n\n---\n\n")}

## REGRAS
- Responda SEMPRE em Português Brasil.
- Use Markdown (tabelas, negrito, listas) para formatar respostas.
- Baseie suas respostas EXCLUSIVAMENTE nos dados acima.
- Se não tiver o dado solicitado, informe claramente que a informação não está disponível no contexto.
- Para rankings, ordene do maior para o menor.
- Conversão = ganhos ÷ (ganhos + perdidos) × 100.`;
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
      const allMetrics = await Promise.all(
        userTeams
          .filter((t) => services[t])
          .map(async (t) => ({
            team: t,
            label: TEAMS[t].label,
            metrics: await getCrmMetrics(t, services[t]),
          }))
      );
      const systemPrompt = buildSystemPrompt(allMetrics);

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
