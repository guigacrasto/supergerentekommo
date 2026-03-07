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
  userTeams?: TeamKey[];
  allowedFunnels?: Record<string, number[]>;
  allowedGroups?: Record<string, string[]>;
  pausedPipelines?: number[];
}

// In-memory auth profile cache — avoids 2 Supabase queries per request
interface CachedProfile {
  userId: string;
  role: string;
  teams: TeamKey[];
  allowedFunnels: Record<string, number[]>;
  allowedGroups: Record<string, string[]>;
  pausedPipelines: number[];
  expiresAt: number;
}

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
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

  // Fetch funnel permissions + paused pipelines + group permissions in parallel
  const [permissionsResult, pausedResult, groupResult] = await Promise.all([
    supabase
      .from("user_funnel_permissions")
      .select("team, allowed_funnels")
      .eq("user_id", user.id),
    supabase
      .from("settings")
      .select("value")
      .eq("key", "paused_pipelines")
      .single(),
    supabase
      .from("settings")
      .select("value")
      .eq("key", `user_groups:${user.id}`)
      .single(),
  ]);

  const allowedFunnels: Record<string, number[]> = { azul: [], amarela: [] };
  if (permissionsResult.data) {
    for (const row of permissionsResult.data) {
      const funnels = Array.isArray(row.allowed_funnels) ? row.allowed_funnels : [];
      allowedFunnels[row.team] = funnels;
    }
  }

  let pausedPipelines: number[] = [];
  if (pausedResult.data?.value) {
    try {
      pausedPipelines = Array.isArray(pausedResult.data.value)
        ? pausedResult.data.value
        : JSON.parse(pausedResult.data.value);
    } catch {
      pausedPipelines = [];
    }
  }

  const allowedGroups: Record<string, string[]> = { azul: [], amarela: [] };
  if (groupResult.data?.value) {
    try {
      const val = typeof groupResult.data.value === "string"
        ? JSON.parse(groupResult.data.value)
        : groupResult.data.value;
      for (const [team, groups] of Object.entries(val)) {
        if (Array.isArray(groups)) allowedGroups[team] = groups;
      }
    } catch {
      // ignore
    }
  }

  // Admins always see all configured teams
  const teams: TeamKey[] = profile.role === "admin"
    ? ALL_CONFIGURED_TEAMS
    : (profile.teams || []) as TeamKey[];

  // Cache the result
  authCache.set(token, {
    userId: user.id,
    role: profile.role,
    teams,
    allowedFunnels,
    allowedGroups,
    pausedPipelines,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  });

  req.userId = user.id;
  req.userRole = profile.role;
  req.userTeams = teams;
  req.allowedFunnels = allowedFunnels;
  req.allowedGroups = allowedGroups;
  req.pausedPipelines = pausedPipelines;
  next();
}
