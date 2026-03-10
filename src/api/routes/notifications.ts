import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";

export function notificationsRouter() {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/notifications — Lista notificações do usuário
  router.get("/", async (req: AuthRequest, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = (page - 1) * limit;
      const unreadOnly = req.query.unread === "true";

      let query = supabase
        .from("notifications")
        .select("*", { count: "exact" })
        .eq("user_id", req.userId!)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (unreadOnly) {
        query = query.eq("read", false);
      }

      const { data, count, error } = await query;

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({
        notifications: data || [],
        total: count || 0,
        page,
        limit,
      });
    } catch (error: any) {
      console.error("[Notifications] Erro:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/notifications/unread-count — Conta notificações não lidas
  router.get("/unread-count", async (req: AuthRequest, res) => {
    try {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", req.userId!)
        .eq("read", false);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ count: count || 0 });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/notifications/:id/read — Marca notificação como lida
  router.patch("/:id/read", async (req: AuthRequest, res) => {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", req.params.id)
        .eq("user_id", req.userId!);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/notifications/read-all — Marca todas como lidas
  router.post("/read-all", async (req: AuthRequest, res) => {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", req.userId!)
        .eq("read", false);

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/notifications/push-subscribe — Registra subscription push
  router.post("/push-subscribe", async (req: AuthRequest, res) => {
    try {
      const { endpoint, keys } = req.body;

      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        res.status(400).json({ error: "Subscription inválida." });
        return;
      }

      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            user_id: req.userId!,
            endpoint,
            keys,
          },
          { onConflict: "user_id,endpoint" }
        );

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
