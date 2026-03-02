import { Router } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { KommoService } from "../../services/kommo.js";
import { TeamKey } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { getConversationInsights } from "../cache/conversation-cache.js";

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
          return getConversationInsights(team, services[team], genAI);
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

  return router;
}
