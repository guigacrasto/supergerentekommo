import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { TeamKey } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { getConversationInsights, clearInsightsCache } from "../cache/conversation-cache.js";

export function insightsRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  router.get("/conversations", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "SUA_CHAVE_AQUI") {
      res.status(400).json({ error: "GEMINI_API_KEY nao configurada" });
      return;
    }

    try {
      const allInsights = [];
      let anyProcessing = false;

      const teamResults = await Promise.all(
        userTeams.filter((t) => !!services[t]).map(async (team) => {
          try {
            return await getConversationInsights(team, services[team], genAI);
          } catch (teamErr: any) {
            console.error(`[Insights] Erro na equipe ${team}:`, teamErr.message);
            return { data: [], processing: false };
          }
        })
      );
      for (const result of teamResults) {
        allInsights.push(...result.data);
        if (result.processing) anyProcessing = true;
      }

      res.json({ insights: allInsights, processing: anyProcessing });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Insights] Error:", error);
      res.status(500).json({ error: message });
    }
  });

  const REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  const lastRefreshAt: Record<string, number> = {};

  router.post("/refresh", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];

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
      for (const team of userTeams) {
        if (services[team]) {
          clearInsightsCache(team);
        }
      }

      // Trigger fresh fetch (returns immediately with processing: true)
      const allInsights = [];
      let anyProcessing = false;

      const teamResults = await Promise.all(
        userTeams.filter((t) => !!services[t]).map(async (team) => {
          try {
            return await getConversationInsights(team, services[team], genAI);
          } catch (teamErr: any) {
            console.error(`[Insights] Erro ao refresh equipe ${team}:`, teamErr.message);
            return { data: [], processing: false };
          }
        })
      );

      for (const result of teamResults) {
        allInsights.push(...result.data);
        if (result.processing) anyProcessing = true;
      }

      res.json({ insights: allInsights, processing: anyProcessing });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Insights] Refresh error:", error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
