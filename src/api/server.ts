import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { KommoService } from "../services/kommo.js";
import { TeamKey } from "../config.js";
import { pipelinesRouter } from "./routes/pipelines.js";
import { leadsRouter } from "./routes/leads.js";
import { reportsRouter } from "./routes/reports.js";
import { chatRouter } from "./routes/chat.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { oauthRouter } from "./routes/oauth.js";
import { insightsRouter } from "./routes/insights.js";
import { isCacheReady } from "./readiness.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(services: Record<TeamKey, KommoService>) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check — returns 503 until cache is warm so Railway waits
  app.get("/health", (_req, res) => {
    if (isCacheReady()) {
      res.json({ ok: true });
    } else {
      res.status(503).json({ ok: false, reason: "warming_cache" });
    }
  });

  app.use("/api/pipelines", pipelinesRouter(services));
  app.use("/api/leads", leadsRouter(services));
  app.use("/api/reports", reportsRouter(services));
  app.use("/api/chat", chatRouter(services));
  app.use("/api/insights", insightsRouter(services));
  app.use("/api/auth", authRouter());
  app.use("/api/admin", adminRouter(services));
  app.use("/api/oauth", oauthRouter(services));

  const webPath = join(__dirname, "../../web/dist");
  app.use(express.static(webPath));

  app.get(/(.*)/, (_req, res) => {
    res.sendFile(join(webPath, "index.html"));
  });

  return app;
}
