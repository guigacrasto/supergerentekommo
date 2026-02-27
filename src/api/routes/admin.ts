import { Router } from "express";
import { supabase } from "../supabase.js";
import { requireAdmin, AuthRequest } from "../middleware/requireAuth.js";

export function adminRouter(): Router {
  const router = Router();
  router.use(requireAdmin as any);

  // GET /api/admin/users
  router.get("/users", async (_req, res) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, status, role, teams, created_at")
      .eq("role", "user")
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json(data);
  });

  // POST /api/admin/users/:id/approve
  router.post("/users/:id/approve", async (req, res) => {
    const { teams } = req.body; // e.g. ["azul"] or ["azul","amarela"]
    const updateData: any = { status: "approved" };
    if (Array.isArray(teams) && teams.length > 0) {
      updateData.teams = teams;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", req.params.id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Usuário aprovado." });
  });

  // POST /api/admin/users/:id/deny
  router.post("/users/:id/deny", async (req, res) => {
    const { error } = await supabase
      .from("profiles")
      .update({ status: "denied" })
      .eq("id", req.params.id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Usuário negado." });
  });

  // GET /api/admin/tokens
  router.get("/tokens", async (_req, res) => {
    const { data, error } = await supabase
      .from("token_logs")
      .select(`user_id, total_tokens, prompt_tokens, completion_tokens, created_at, profiles!inner(name, email)`)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const byUser: Record<string, any> = {};
    for (const row of data || []) {
      const uid = row.user_id;
      if (!byUser[uid]) {
        byUser[uid] = {
          userId: uid,
          name: (row.profiles as any).name,
          email: (row.profiles as any).email,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          messages: 0,
          estimatedCostUSD: 0,
        };
      }
      byUser[uid].totalTokens += row.total_tokens;
      byUser[uid].promptTokens += row.prompt_tokens;
      byUser[uid].completionTokens += row.completion_tokens;
      byUser[uid].messages += 1;
      byUser[uid].estimatedCostUSD +=
        (row.prompt_tokens * 0.075 + row.completion_tokens * 0.30) / 1_000_000;
    }

    const result = Object.values(byUser)
      .sort((a: any, b: any) => b.totalTokens - a.totalTokens)
      .map((u: any) => ({ ...u, estimatedCostUSD: `$${u.estimatedCostUSD.toFixed(4)}` }));

    res.json(result);
  });

  return router;
}
