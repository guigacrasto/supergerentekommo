import { Response, NextFunction } from "express";
import { AuthRequest } from "./requireAuth.js";
import { supabase } from "../supabase.js";

const ACTION_MAP: Record<string, string> = {
  "GET /api/reports": "view_reports",
  "GET /api/pipelines": "view_pipelines",
  "GET /api/leads": "view_leads",
  "POST /api/chat": "chat_message",
  "GET /api/chat": "view_chat",
  "GET /api/insights": "view_insights",
  "POST /api/insights": "refresh_insights",
  "GET /api/admin": "admin_view",
  "POST /api/admin": "admin_action",
  "PATCH /api/admin": "admin_action",
  "GET /api/notifications": "view_notifications",
  "GET /api/reports/predictions": "view_predictions",
};

function resolveAction(method: string, path: string): string {
  // Try exact match first
  const exactKey = `${method} ${path}`;
  if (ACTION_MAP[exactKey]) return ACTION_MAP[exactKey];

  // Try prefix match
  for (const [key, action] of Object.entries(ACTION_MAP)) {
    const [keyMethod, keyPath] = key.split(" ");
    if (method === keyMethod && path.startsWith(keyPath)) return action;
  }

  return `${method.toLowerCase()}_${path.split("/api/")[1]?.split("/")[0] || "unknown"}`;
}

// Fire-and-forget audit log — never blocks the request
function logAsync(
  userId: string | undefined,
  userEmail: string | undefined,
  action: string,
  resource: string,
  method: string,
  details: Record<string, any>,
  ip: string
): void {
  supabase
    .from("audit_logs")
    .insert({
      user_id: userId || null,
      user_email: userEmail || null,
      action,
      resource,
      method,
      details,
      ip,
    })
    .then(({ error }) => {
      if (error) console.error("[AuditLog] Erro ao salvar:", error.message);
    });
}

export function auditLog(req: AuthRequest, res: Response, next: NextFunction): void {
  const method = req.method;
  const path = req.originalUrl.split("?")[0];

  // Skip health check and static files
  if (path === "/health" || !path.startsWith("/api/")) {
    next();
    return;
  }

  // Skip auth routes (login/register already logged separately)
  if (path.startsWith("/api/auth")) {
    next();
    return;
  }

  // Skip webhook routes (not user-initiated)
  if (path.startsWith("/api/webhooks")) {
    next();
    return;
  }

  const action = resolveAction(method, path);
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";

  // Build details from query params and relevant body fields
  const details: Record<string, any> = {};
  if (Object.keys(req.query).length > 0) details.query = req.query;
  if (req.body && method !== "GET") {
    // Don't log sensitive fields
    const { password, currentPassword, newPassword, token, code, secret, challengeToken, backupCodes, ...safeBody } = req.body;
    if (Object.keys(safeBody).length > 0) details.body = safeBody;
  }

  logAsync(req.userId, undefined, action, path, method, details, ip);
  next();
}

// Cleanup old audit logs (> 90 days)
export function startAuditCleanup(): void {
  const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

  const cleanup = async () => {
    try {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("audit_logs")
        .delete()
        .lt("created_at", cutoff);

      if (error) console.error("[AuditLog] Erro no cleanup:", error.message);
      else console.log("[AuditLog] Cleanup concluído (> 90 dias removidos)");
    } catch (err: any) {
      console.error("[AuditLog] Erro no cleanup:", err.message);
    }
  };

  // Run once on startup, then every 24h
  cleanup();
  setInterval(cleanup, CLEANUP_INTERVAL_MS);
}
