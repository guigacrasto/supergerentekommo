import webpush from "web-push";
import { supabase } from "../supabase.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:admin@supergerente.com";

// Configure web-push with VAPID keys
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log("[Push] VAPID keys configuradas");
} else {
  console.warn("[Push] VAPID keys não configuradas — push notifications desativadas");
}

export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  try {
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("endpoint, keys")
      .eq("user_id", userId);

    if (!subscriptions || subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title,
      body,
      icon: "/logo-192.png",
      badge: "/logo-192.png",
      data: data || {},
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys as any,
          },
          payload
        )
      )
    );

    // Remove expired subscriptions (410 Gone)
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const statusCode = (result.reason as any)?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", subscriptions[i].endpoint)
            .eq("user_id", userId);
          console.log(`[Push] Subscription removida (expirada): ${subscriptions[i].endpoint.substring(0, 50)}...`);
        }
      }
    }
  } catch (err: any) {
    console.error("[Push] Erro ao enviar push:", err.message);
  }
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}
