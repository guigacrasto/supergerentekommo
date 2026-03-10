import { Request, Response, NextFunction } from "express";
import { supabase } from "../supabase.js";
import { TeamKey, TEAMS } from "../../config.js";

// All configured teams (those with a subdomain set)
const ALL_CONFIGURED_TEAMS = (Object.keys(TEAMS) as TeamKey[]).filter(
  (k) => TEAMS[k].subdomain
);

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userTeams?: string[];
  allowedFunnels?: Record<string, number[]>;
  allowedGroups?: Record<string, string[]>;
  pausedPipelines?: number[];
  tenantId?: string;
  tenant?: any;
}

// In-memory auth profile cache — avoids Supabase queries per request
interface CachedProfile {
  userId: string;
  role: string;
  teams: string[];
  allowedFunnels: Record<string, number[]>;
  allowedGroups: Record<string, string[]>;
  pausedPipelines: number[];
  tenantId?: string;
  tenant?: any;
  expiresAt: number;
}

const AUTH_CACHE_TTL_MS = 60 * 1000; // 1 minute — reflect permission changes quickly
const authCache = new Map<string, CachedProfile>();

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authCache) {
    if (now > entry.expiresAt) authCache.delete(key);
  }
}, 10 * 60 * 1000);

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Token não fornecido." });
    return;
  }

  // Check cache first
  const cached = authCache.get(token);
  if (cached && Date.now() < cached.expiresAt) {
    req.userId = cached.userId;
    req.userRole = cached.role;
    req.userTeams = cached.teams;
    req.allowedFunnels = cached.allowedFunnels;
    req.allowedGroups = cached.allowedGroups;
    req.pausedPipelines = cached.pausedPipelines;
    req.tenantId = cached.tenantId;
    req.tenant = cached.tenant;
    return next();
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    authCache.delete(token);
    res.status(401).json({ error: "Token inválido." });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status, role, teams")
    .eq("id", user.id)
    .single();

  if (!profile || profile.status !== "approved") {
    res.status(403).json({ error: "Acesso pendente de aprovação." });
    return;
  }

  // Fetch funnel permissions (user_funnel_permissions may not exist yet)
  const allowedFunnels: Record<string, number[]> = {};
  try {
    const { data: perms } = await supabase
      .from("user_funnel_permissions")
      .select("team, allowed_funnels")
      .eq("user_id", user.id);
    if (perms) {
      for (const row of perms) {
        const funnels = Array.isArray(row.allowed_funnels) ? row.allowed_funnels : [];
        allowedFunnels[row.team] = funnels;
      }
    }
  } catch {
    // Table may not exist yet
  }

  // Fetch globally paused pipelines from settings
  let pausedPipelines: number[] = [];
  try {
    const { data: setting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "paused_pipelines")
      .single();
    if (setting?.value) {
      pausedPipelines = Array.isArray(setting.value) ? setting.value : JSON.parse(setting.value);
    }
  } catch {
    // Table may not exist yet
  }

  // Determine teams: admin see all configured, users see their own
  const teams: string[] = (profile.role === "admin" || profile.role === "superadmin")
    ? ALL_CONFIGURED_TEAMS
    : (profile.teams || []);

  // Cache the result
  authCache.set(token, {
    userId: user.id,
    role: profile.role,
    teams,
    allowedFunnels,
    allowedGroups: {},
    pausedPipelines,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  });

  req.userId = user.id;
  req.userRole = profile.role;
  req.userTeams = teams;
  req.allowedFunnels = allowedFunnels;
  req.allowedGroups = {};
  req.pausedPipelines = pausedPipelines;

  next();
}
