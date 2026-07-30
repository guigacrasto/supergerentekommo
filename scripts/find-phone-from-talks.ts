/**
 * Tenta descobrir o telefone do canal WhatsApp via talks/chats do Kommo
 */
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getToken(team: string) {
  let subdomain = team === "azul" ? (process.env.KOMMO_SUBDOMAIN || "") : (process.env.KOMMO_AMARELA_SUBDOMAIN || "");
  const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0").single();
  if (tenant?.settings?.teams?.[team]?.subdomain) subdomain = tenant.settings.teams[team].subdomain;
  const { data: tokenRows } = await supabase.from("settings").select("key, value").eq("key", `kommo_${team}_access_token`);
  let accessToken = (tokenRows || [])[0]?.value || "";
  if (!accessToken) accessToken = team === "azul" ? (process.env.KOMMO_ACCESS_TOKEN || "") : (process.env.KOMMO_AMARELA_ACCESS_TOKEN || "");
  return { subdomain, accessToken };
}

async function tryEndpoint(sub: string, token: string, path: string, label: string) {
  try {
    const res = await fetch(`https://${sub}.kommo.com/api/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    console.log(`  ${label} [${res.status}]: ${text.slice(0, 800)}`);
    return { status: res.status, data: text ? JSON.parse(text) : null };
  } catch (e: any) {
    console.log(`  ${label}: ${e.message}`);
    return null;
  }
}

async function main() {
  const token = await getToken("amarela");
  const leadId = 25216757;
  const contactId = 43859893;

  console.log("=== TENTANDO DESCOBRIR TELEFONE DO CANAL WHATSAPP ===\n");

  // 1. Talks do lead
  await tryEndpoint(token.subdomain, token.accessToken, `/talks?filter[entity_type]=leads&filter[entity_id]=${leadId}`, "talks filter by lead");

  // 2. Chats (endpoint separado)
  await tryEndpoint(token.subdomain, token.accessToken, `/chats?filter[entity_type]=leads&filter[entity_id]=${leadId}`, "chats filter by lead");

  // 3. Contact chats
  await tryEndpoint(token.subdomain, token.accessToken, `/contacts/${contactId}/chats`, "contact chats");

  // 4. Talks sem filtro (listar disponíveis)
  await tryEndpoint(token.subdomain, token.accessToken, `/talks?limit=3`, "talks list");

  // 5. Events tipo incoming_chat_message
  await tryEndpoint(token.subdomain, token.accessToken, `/events?filter[entity]=lead&filter[entity_id]=${leadId}&filter[type]=incoming_chat_message`, "events incoming_chat");

  // 6. Events tipo lead_added
  await tryEndpoint(token.subdomain, token.accessToken, `/events?filter[entity]=lead&filter[entity_id]=${leadId}&filter[type]=lead_added`, "events lead_added");

  // 7. Events todos do lead (mais detalhes)
  const evResult = await tryEndpoint(token.subdomain, token.accessToken, `/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=20`, "all events");

  // 8. Pipeline sources
  await tryEndpoint(token.subdomain, token.accessToken, `/leads/pipelines/12731867`, "pipeline details");

  // 9. Amojo endpoint
  try {
    const amojoRes = await fetch(`https://amojo.kommo.com/v2/origin/custom/${token.subdomain}`, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    console.log(`\n  amojo origin [${amojoRes.status}]: ${(await amojoRes.text()).slice(0, 500)}`);
  } catch (e: any) {
    console.log(`\n  amojo: ${e.message}`);
  }

  // 10. Webhook payload — check se o webhook recebe source info
  // Vamos ver o webhook log se existe
  console.log("\n\n=== VERIFICANDO WEBHOOK LOG ===");
  const { data: recentWebhooks } = await supabase
    .from("webhook_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);

  if (recentWebhooks && recentWebhooks.length > 0) {
    for (const wh of recentWebhooks) {
      console.log(`\n  Webhook: ${JSON.stringify(wh).slice(0, 1000)}`);
    }
  } else {
    console.log("  Sem logs de webhook no banco");
  }

  // 11. Buscar se o lead tem custom_fields que chegaram depois
  console.log("\n\n=== RE-CHECANDO LEAD COM MAIS OPÇÕES ===");
  await tryEndpoint(token.subdomain, token.accessToken, `/leads/${leadId}?with=contacts,companies,source_id,catalog_elements,is_price_modified_by_robot,loss_reason`, "lead full");
}

main().catch(console.error);
