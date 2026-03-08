import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { corsOrigins } from "../config.js";
import { pipelinesRouter } from "./routes/pipelines.js";
import { leadsRouter } from "./routes/leads.js";
import { reportsRouter } from "./routes/reports.js";
import { chatRouter } from "./routes/chat.js";
import { authRouter } from "./routes/auth.js";
import { insightsRouter } from "./routes/insights.js";
import { adminRouter } from "./routes/admin.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { notificationsRouter } from "./routes/notifications.js";
import { superRouter } from "./routes/super.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { isCacheReady, getTokenStatuses } from "./readiness.js";
import { auditLog } from "./middleware/auditLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer() {
  const app = express();

  app.use(
    cors(
      corsOrigins.length > 0
        ? {
            origin: (origin, cb) => {
              if (!origin || corsOrigins.includes(origin)) cb(null, true);
              else cb(new Error("CORS blocked"));
            },
            credentials: true,
          }
        : undefined
    )
  );
  app.use(express.json());

  // Audit log middleware — logs all authenticated API requests
  app.use(auditLog as any);

  // Health check — returns 503 until cache is warm so Railway waits
  app.get("/health", (_req, res) => {
    if (isCacheReady()) {
      const tokens = getTokenStatuses();
      const tokenMap: Record<string, string> = {};
      for (const t of tokens) {
        tokenMap[t.label] = t.status;
      }
      res.json({ ok: true, tokens: tokenMap });
    } else {
      res.status(503).json({ ok: false, reason: "warming_cache" });
    }
  });

  // Webhook routes (public, no auth)
  app.use("/api/webhooks", webhooksRouter());

  // Auth routes (mostly public)
  app.use("/api/auth", authRouter());

  // All below require auth
  app.use("/api/pipelines", requireAuth as any, pipelinesRouter());
  app.use("/api/leads", requireAuth as any, leadsRouter());
  app.use("/api/reports", requireAuth as any, reportsRouter());
  app.use("/api/chat", requireAuth as any, chatRouter());
  app.use("/api/insights", requireAuth as any, insightsRouter());
  app.use("/api/admin", requireAuth as any, adminRouter());
  app.use("/api/notifications", notificationsRouter());
  app.use("/api/super", requireAuth as any, superRouter);

  const webPath = join(__dirname, "../../web/dist");
  app.use(express.static(webPath));

  app.get(/(.*)/, (_req, res) => {
    res.sendFile(join(webPath, "index.html"));
  });

  return app;
}
