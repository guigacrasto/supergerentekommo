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

  // Temporary debug endpoint (public) — remove after diagnosing "Não informado"
  app.get("/api/debug/custom-fields", async (_req, res) => {
    try {
      const { getTeamConfigsFromTenant } = await import("../config.js");
      const { getCrmMetrics } = await import("./cache/crm-cache.js");
      const { KommoService } = await import("../services/kommo.js");

      const teamConfigs = getTeamConfigsFromTenant();
      const rendaPattern = /renda|sal[aá]rio|income|faixa.*sal|receita/i;
      const profPattern = /profiss[aã]o|ocupa[cç][aã]o|cargo|profession|job/i;

      const result: any = { teams: [] };

      for (const [teamKey, tc] of Object.entries(teamConfigs)) {
        if (!tc.subdomain) continue;
        const service = new KommoService(tc, teamKey);
        const metrics = await getCrmMetrics(teamKey, service);

        const leadFieldCounts: Record<string, number> = {};
        const contactFieldCounts: Record<string, number> = {};
        let totalLeads = 0;
        let leadsWithCf = 0;
        let leadsWithContactCf = 0;
        const rendaSamples: any[] = [];
        const profSamples: any[] = [];

        // Debug: fetch raw contacts directly to check
        let rawContactsCount = 0;
        let rawContactsWithCf = 0;
        const rawContactFieldNames: Record<string, number> = {};
        try {
          const rawContacts = await service.getContacts();
          rawContactsCount = rawContacts.length;
          for (const c of rawContacts) {
            if (c.custom_fields_values && c.custom_fields_values.length > 0) {
              rawContactsWithCf++;
              for (const cf of c.custom_fields_values) {
                const name = cf.field_name || cf.field_code || "unknown";
                rawContactFieldNames[name] = (rawContactFieldNames[name] || 0) + 1;
              }
            }
          }
        } catch (e: any) {
          console.error(`Debug: error fetching contacts for ${teamKey}:`, e.message);
        }

        for (const lead of metrics.leadSnapshots) {
          totalLeads++;
          if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            leadsWithCf++;
            for (const cf of lead.custom_fields_values) {
              const name = cf.field_name || cf.field_code || "unknown";
              leadFieldCounts[name] = (leadFieldCounts[name] || 0) + 1;
              if (rendaPattern.test(name) && rendaSamples.length < 30) {
                rendaSamples.push({ leadId: lead.id, field: name, value: cf.values?.[0]?.value, source: "lead" });
              }
              if (profPattern.test(name) && profSamples.length < 30) {
                profSamples.push({ leadId: lead.id, field: name, value: cf.values?.[0]?.value, source: "lead" });
              }
            }
          }
          const contactCfs = metrics.contactCfByLead[lead.id];
          if (contactCfs && contactCfs.length > 0) {
            leadsWithContactCf++;
            for (const cf of contactCfs) {
              const name = cf.field_name || cf.field_code || "unknown";
              contactFieldCounts[name] = (contactFieldCounts[name] || 0) + 1;
              if (rendaPattern.test(name) && rendaSamples.length < 30) {
                rendaSamples.push({ leadId: lead.id, field: name, value: cf.values?.[0]?.value, source: "contact" });
              }
              if (profPattern.test(name) && profSamples.length < 30) {
                profSamples.push({ leadId: lead.id, field: name, value: cf.values?.[0]?.value, source: "contact" });
              }
            }
          }
        }

        result.teams.push({
          team: teamKey,
          totalLeads,
          leadsWithCf,
          leadsWithContactCf,
          contactCfByLeadCount: Object.keys(metrics.contactCfByLead).length,
          rawContactsCount,
          rawContactsWithCf,
          rawContactFieldNames: Object.entries(rawContactFieldNames).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
          leadFields: Object.entries(leadFieldCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
          contactFields: Object.entries(contactFieldCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
          rendaSamples,
          profSamples,
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

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
