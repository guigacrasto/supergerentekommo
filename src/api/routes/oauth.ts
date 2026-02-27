import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { loadTokens } from "../../services/token-store.js";
import { requireAdmin } from "../middleware/requireAuth.js";
import { kommoConfig } from "../../config.js";

export function oauthRouter(service: KommoService): Router {
  const router = Router();
  router.use(requireAdmin as any);

  // GET /api/oauth/start — returns the Kommo authorization URL for the admin to visit
  router.get("/start", (_req, res) => {
    const authUrl =
      `https://${kommoConfig.subdomain}.kommo.com/oauth?` +
      `client_id=${kommoConfig.clientId}` +
      `&state=renew` +
      `&mode=post_message`;
    res.json({ authUrl });
  });

  // POST /api/oauth/exchange — exchange the authorization code for tokens
  router.post("/exchange", async (req, res) => {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: "Código de autorização não fornecido." });
      return;
    }
    try {
      const tokens = await service.exchangeAuthCode(code);
      res.json({ message: "Token renovado com sucesso!", accessToken: tokens.accessToken.slice(0, 20) + "..." });
    } catch (err: any) {
      console.error("[OAuth] Exchange failed:", err.response?.data || err.message);
      res.status(500).json({ error: err.response?.data?.hint || err.message });
    }
  });

  // GET /api/oauth/status — current token info
  router.get("/status", async (_req, res) => {
    try {
      const stored = await loadTokens();
      const hasRefreshToken = !!stored?.refreshToken;

      // Decode access token expiry without verifying signature
      let expiresAt: string | null = null;
      const token = stored?.accessToken || kommoConfig.accessToken || "";
      if (token) {
        try {
          const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
          expiresAt = new Date(payload.exp * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        } catch { /* ignore decode errors */ }
      }

      res.json({ hasRefreshToken, expiresAt });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
