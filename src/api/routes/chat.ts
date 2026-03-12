import { Router } from "express";
import { randomUUID } from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { getCrmMetrics, CrmMetrics } from "../cache/crm-cache.js";
import { AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";
import { getTeamConfigsFromTenant } from "../../config.js";
import { getActivityMetrics, ActivityMetrics } from "../cache/activity-cache.js";

interface ChatSession {
  history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  lastActivity: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, ChatSession>();

function buildMentorInstruction(mentor: {
  name: string;
  system_prompt: string;
  methodology_text: string;
}): string {
  let instruction = `## VOCE E O MENTOR: ${mentor.name.toUpperCase()}\n${mentor.system_prompt}`;
  if (mentor.methodology_text?.trim()) {
    instruction += `\n\n## METODOLOGIA DE REFERENCIA (${mentor.name})\n${mentor.methodology_text}`;
  }
  return instruction;
}

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
          `  ${f.nome}: ${f.total} leads | ganhos: ${f.ganhos} | perdidos: ${f.perdidos} | ativos: ${f.ativos} | conversao: ${f.conversao} | novos hoje: ${f.novosHoje} | novos semana: ${f.novosSemana} | novos mes: ${f.novosMes}`
      )
      .join("\n");

    const vendedoresTexto = vendedores
      .map(
        (v) =>
          `  ${v.nome} | ${v.funil} | total: ${v.total} | ganhos: ${v.ganhos} | perdidos: ${v.perdidos} | ativos: ${v.ativos} | conversao: ${v.conversao} | novos semana: ${v.novosSemana} | novos mes: ${v.novosMes}`
      )
      .join("\n");

    let activityTexto = "";
    if (activity) {
      const ab = activity.leadsAbandonados48h;
      const risco = activity.leadsEmRisco7d;
      const tarefas = activity.tarefasVencidas;
      activityTexto = `
ALERTAS DE ATIVIDADE (${activity.atualizadoEm}):
  Leads sem atividade ha +48h: ${ab.length}${ab.length > 0 ? " — " + ab.slice(0, 5).map((l) => `${l.nome} (${l.vendedor}, ${l.diasSemAtividade}d)`).join(", ") + (ab.length > 5 ? ` e mais ${ab.length - 5}` : "") : ""}
  Leads em risco (sem atividade +7d): ${risco.length}${risco.length > 0 ? " — " + risco.slice(0, 5).map((l) => `${l.nome} (${l.vendedor}, ${l.diasSemAtividade}d)`).join(", ") + (risco.length > 5 ? ` e mais ${risco.length - 5}` : "") : ""}
  Tarefas vencidas: ${tarefas.length}${tarefas.length > 0 ? " — " + tarefas.slice(0, 5).map((t) => `${t.texto} (${t.vendedor}, ${t.diasVencida}d vencida)`).join(", ") + (tarefas.length > 5 ? ` e mais ${tarefas.length - 5}` : "") : ""}`;
    }

    return `## ${label.toUpperCase()} — DADOS ATUALIZADOS EM: ${metrics.atualizadoEm}

⚠️ COBERTURA DOS DADOS DISPONIVEIS:
- "novosHoje" = leads criados nas ultimas 24h (janela rolante, NAO dia calendario)
- "novosSemana" = leads criados nos ultimos 7 dias (janela rolante, NAO semana seg-dom)
- "novosMes" = leads criados nos ultimos 30 dias (janela rolante, NAO mes calendario)
- "total/ativos/ganhos/perdidos" = acumulado historico completo do funil
- NAO ha dados de "semana passada" ou periodos anteriores especificos — apenas janelas rolantes.

RESUMO GERAL: ${geral.total} leads | ganhos: ${geral.ganhos} | perdidos: ${geral.perdidos} | ativos: ${geral.ativos} | conversao: ${geral.conversao} | novos hoje: ${geral.novosHoje}

METRICAS POR FUNIL:
${funisTexto}

METRICAS POR VENDEDOR × FUNIL:
${vendedoresTexto}
${activityTexto}`;
  });

  return `Voce e o assistente analitico de CRM da empresa. Responda gerentes com precisao, profissionalismo e analise aprofundada.

${sections.join("\n\n---\n\n")}

## REGRAS GERAIS
- Responda SEMPRE em Portugues Brasil.
- Use Markdown (tabelas, negrito, listas) para formatar respostas.
- Baseie suas respostas EXCLUSIVAMENTE nos dados acima.
- Se nao tiver o dado solicitado, informe claramente que nao esta disponivel.
- Para rankings, ordene do maior para o menor.
- Conversao = ganhos ÷ (ganhos + perdidos) × 100.

## MODO ANALITICO — SEMPRE APLIQUE
- Ao analisar performance, identifique os **TOP 3 INSIGHTS** mais relevantes antes de responder.
- Faca **COMPARATIVOS** sempre que possivel: funil A vs. B, agente X vs. media, esta semana vs. mes.
- Identifique **ANOMALIAS**: agentes muito acima ou abaixo da media, funis com conversao muito baixa.
- Conclua analises com uma **RECOMENDACAO DE ACAO** clara e objetiva.
- Para perguntas sobre acompanhamento: use os dados de ALERTAS DE ATIVIDADE acima.
- Use tom executivo: direto, baseado em dados, orientado a resultado.

## FORMATACAO OBRIGATORIA
- Use emojis para organizar secoes: 📊 para dados/tabelas, 💡 para insights, ⚠️ para anomalias, ✅ para recomendacoes, 🏆 para rankings, 📋 para resumos
- Sempre que houver metricas numericas, use tabela Markdown: | coluna | valor |
- Separe secoes com linha horizontal: ---
- Maximo 3 bullet points por secao — seja conciso
- Nunca escreva paragrafos longos sem estrutura visual

## METADADOS OBRIGATORIOS
- Ao citar dados, SEMPRE inclua ao final: 📡 Fonte: Kommo CRM | ⏱️ Dados de: [cite o atualizadoEm]
- Se dados vierem zerados: explique que o funil pode nao ter atividade no periodo. NAO assuma erro de sistema.
- Se o usuario perguntar sobre "semana passada": esclareca que so ha janelas rolantes de 7/30 dias e ofereca os dados disponiveis.`;
}

export function chatRouter() {
  const router = Router();

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  // GET /api/chat/mentors — list of active mentors for the selector
  router.get("/mentors", async (_req, res) => {
    const { data, error } = await supabase
      .from("mentors")
      .select("id, name, description")
      .eq("is_active", true)
      .order("name");
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  });

  router.post("/", async (req, res) => {
    const authReq = req as AuthRequest;
    const { message, sessionId: incomingSessionId, mentorIds }: { message: string; sessionId?: string; mentorIds?: string[] } = req.body;

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "SUA_CHAVE_AQUI") {
      return res.json({
        response: "Ops! Eu preciso de uma GEMINI_API_KEY no arquivo .env para funcionar.",
      });
    }

    try {
      // Build KommoService instances from config
      const teamConfigs = getTeamConfigsFromTenant(authReq.tenant);
      const userTeams = authReq.userTeams || [];

      const metricsPerTeam = await Promise.all(
        userTeams
          .filter((t) => !!teamConfigs[t] && teamConfigs[t].subdomain)
          .map(async (t) => {
            const cfg = teamConfigs[t];
            const kommoService = new KommoService(cfg, t, authReq.tenantId);
            const crmMetrics = await getCrmMetrics(t, kommoService, authReq.tenantId, cfg.excludePipelineNames);
            const activity = await getActivityMetrics(t, kommoService, crmMetrics, { dddProibidoEnabled: authReq.tenant?.settings?.dddProibidoEnabled === true });
            return { team: t, label: cfg.label, crmMetrics, activity };
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

      // Fetch mentor data if mentorIds provided
      let mentors: Array<{ id: string; name: string; system_prompt: string; methodology_text: string }> = [];
      if (mentorIds && mentorIds.length > 0) {
        const { data } = await supabase
          .from("mentors")
          .select("id, name, system_prompt, methodology_text")
          .in("id", mentorIds)
          .eq("is_active", true);
        mentors = data || [];
      }

      const finalSystemPrompt =
        mentors.length === 1
          ? buildMentorInstruction(mentors[0]) + "\n\n---\n\n" + systemPrompt
          : systemPrompt;

      const sessionId = incomingSessionId || randomUUID();
      const now = Date.now();

      for (const [id, session] of sessions.entries()) {
        if (now - session.lastActivity > SESSION_TTL_MS) sessions.delete(id);
      }

      const session: ChatSession = sessions.get(sessionId) ?? { history: [], lastActivity: now };

      let responseText: string;
      let usageMeta: any;

      if (mentors.length > 1) {
        // Council mode: parallel calls, one per mentor
        const mentorResponses = await Promise.all(
          mentors.map(async (mentor) => {
            const mentorPrompt = buildMentorInstruction(mentor) + "\n\n---\n\n" + systemPrompt;
            const mentorModel = genAI.getGenerativeModel({
              model: "gemini-2.5-flash",
              systemInstruction: mentorPrompt,
            });
            const mentorChat = mentorModel.startChat({ history: [] });
            const r = await mentorChat.sendMessage(message);
            return { name: mentor.name, response: r.response.text() };
          })
        );

        // Synthesis call
        const synthesisPrompt = `Voce e um moderador de conselho de mentores. Os seguintes mentores responderam a pergunta do gerente.
Apresente a opiniao de cada mentor claramente (com o nome como titulo), depois sintetize um **VEREDITO FINAL** consolidado.

Pergunta do gerente: ${message}

${mentorResponses.map((m) => `## Mentor: ${m.name}\n${m.response}`).join("\n\n---\n\n")}`;

        const synthModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const synthChat = synthModel.startChat({ history: [] });
        const synthResult = await synthChat.sendMessage(synthesisPrompt);
        responseText = synthResult.response.text();
        usageMeta = synthResult.response.usageMetadata;
      } else {
        // Single mentor or no mentor — standard flow
        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          systemInstruction: finalSystemPrompt,
        });
        const chat = model.startChat({ history: session.history });
        const result = await chat.sendMessage(message);
        responseText = result.response.text();
        usageMeta = result.response.usageMetadata;
      }

      // Log token usage
      if (usageMeta && authReq.userId) {
        await supabase.from("token_logs").insert({
          user_id: authReq.userId,
          session_id: sessionId,
          prompt_tokens: usageMeta.promptTokenCount ?? 0,
          completion_tokens: usageMeta.candidatesTokenCount ?? 0,
          total_tokens: usageMeta.totalTokenCount ?? 0,
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
