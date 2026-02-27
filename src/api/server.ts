import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { KommoService } from "../services/kommo.js";
import { pipelinesRouter } from "./routes/pipelines.js";
import { leadsRouter } from "./routes/leads.js";
import { reportsRouter } from "./routes/reports.js";
import { chatRouter } from "./routes/chat.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(service: KommoService) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/pipelines", pipelinesRouter(service));
  app.use("/api/leads", leadsRouter(service));
  app.use("/api/reports", reportsRouter(service));
  app.use("/api/chat", chatRouter(service));
  app.use("/api/auth", authRouter());
  app.use("/api/admin", adminRouter());

  // Servir o frontend React compilado
  const webPath = join(__dirname, "../../web/dist");
  app.use(express.static(webPath));

  // SPA fallback — serves index.html for any non-API route
  app.get(/(.*)/, (_req, res) => {
    res.sendFile(join(webPath, "index.html"));
  });

  return app;
}
