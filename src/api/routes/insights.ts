import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { TeamKey } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { fetchFilteredInsights, clearInsightsCache } from "../cache/conversation-cache.js";
import { getCrmMetrics } from "../cache/crm-cache.js";

export function insightsRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  // Admin-only guard
  function requireAdmin(req: AuthRequest, res: any, next: any) {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }
    next();
  }

  // GET /filters — returns available funis and agentes for the user's teams
  router.get("/filters", requireAdmin, async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const teamParam = (req.query.team as string) || "";

    const targetTeams = teamParam
      ? userTeams.filter((t) => t === teamParam && !!services[t])
      : userTeams.filter((t) => !!services[t]);

    const funisSet = new Set<string>();
    const agentesSet = new Set<string>();

    for (const team of targetTeams) {
      try {
        const metrics = await getCrmMetrics(team, services[team]);

        // Collect funis (pipeline names)
        for (const name of Object.values(metrics.pipelineNames)) {
          const clean = (name as string).replace(/^FUNIL\s+/i, "");
          funisSet.add(clean);
        }

        // Collect agentes (responsible user names)
        for (const lead of metrics.activeLeads) {
          if (lead.responsibleUserName && lead.responsibleUserName !== "Desconhecido") {
            agentesSet.add(lead.responsibleUserName);
          }
        }
      } catch (err) {
        console.error(`[Insights] Error fetching filters for ${team}:`, err);
      }
    }

    res.json({
      funis: [...funisSet].sort(),
      agentes: [...agentesSet].sort(),
    });
  });

  // GET /conversations — fetch insights with filters (admin only)
  router.get("/conversations", requireAdmin, async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const team = (req.query.team as string) || "";
    const funil = (req.query.funil as string) || "";
    const agente = (req.query.agente as string) || "";

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "SUA_CHAVE_AQUI") {
      res.status(400).json({ error: "GEMINI_API_KEY nao configurada" });
      return;
    }

    // Require at least a team filter
    if (!team) {
      res.status(400).json({ error: "Selecione um time para gerar insights." });
      return;
    }

    try {
      const result = await fetchFilteredInsights(
        services,
        genAI,
        userTeams,
        { team, funil: funil || undefined, agente: agente || undefined }
      );

      res.json({ insights: result.data, processing: result.processing });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Insights] Error:", error);
      res.status(500).json({ error: message });
    }
  });

  const REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const lastRefreshAt: Record<string, number> = {};

  router.post("/refresh", requireAdmin, async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const team = (req.query.team as string) || (req.body?.team as string) || "";
    const funil = (req.query.funil as string) || (req.body?.funil as string) || "";
    const agente = (req.query.agente as string) || (req.body?.agente as string) || "";

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "SUA_CHAVE_AQUI") {
      res.status(400).json({ error: "GEMINI_API_KEY nao configurada" });
      return;
    }

    // Rate-limit: 1 refresh per 5 minutes per user
    const userId = req.userId || "anonymous";
    const now = Date.now();
    if (lastRefreshAt[userId] && now - lastRefreshAt[userId] < REFRESH_COOLDOWN_MS) {
      const waitSec = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastRefreshAt[userId])) / 1000);
      res.status(429).json({ error: `Aguarde ${waitSec}s antes de atualizar novamente.` });
      return;
    }
    lastRefreshAt[userId] = now;

    try {
      // Clear cache for user's teams
      for (const t of userTeams) {
        if (services[t]) {
          clearInsightsCache(t);
        }
      }

      const result = await fetchFilteredInsights(
        services,
        genAI,
        userTeams,
        { team: team || undefined, funil: funil || undefined, agente: agente || undefined }
      );

      res.json({ insights: result.data, processing: result.processing });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Insights] Refresh error:", error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
