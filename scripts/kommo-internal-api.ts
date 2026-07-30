/**
 * Busca source_ids reais via endpoints internos do Kommo
 * (mesmos que a tela de settings/widgets/ usa)
 */
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getToken(team: string) {
  let subdomain = team === "amarela" ? (process.env.KOMMO_AMARELA_SUBDOMAIN || "") : (process.env.KOMMO_SUBDOMAIN || "");
  const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0").single();
  if (tenant?.settings?.teams?.[team]?.subdomain) subdomain = tenant.settings.teams[team].subdomain;
  const { data: tokenRows } = await supabase.from("settings").select("key, value").eq("key", `kommo_${team}_access_token`);
  let accessToken = (tokenRows || [])[0]?.value || "";
  if (!accessToken) accessToken = team === "amarela" ? (process.env.KOMMO_AMARELA_ACCESS_TOKEN || "") : (process.env.KOMMO_ACCESS_TOKEN || "");
  return { subdomain, accessToken };
}

async function tryUrl(url: string, token: string, label: string) {
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    console.log(`\n[${res.status}] ${label}`);
    if (text.length > 0) {
      // Try to parse as JSON and pretty-print relevant parts
      try {
        const json = JSON.parse(text);
        // Look for anything with "source", "phone", "whatsapp" in the data
        const str = JSON.stringify(json);
        if (str.includes("source") || str.includes("phone") || str.includes("whatsapp") || str.includes("channel")) {
          console.log(text.slice(0, 2000));
        } else {
          console.log(text.slice(0, 500));
        }
      } catch {
        console.log(text.slice(0, 500));
      }
    }
    return { status: res.status, text };
  } catch (e: any) {
    console.log(`\n[ERR] ${label}: ${e.message}`);
    return null;
  }
}

async function main() {
  const token = await getToken("amarela");
  const base = `https://${token.subdomain}.kommo.com`;

  console.log("=== BUSCANDO DADOS INTERNOS DO KOMMO ===\n");

  // Account info with sources
  await tryUrl(`${base}/api/v4/account?with=amojo_id,users_groups,task_types,datetime_settings,is_api_filter_enabled,is_loss_reason_enabled`, token.accessToken, "account info");

  // Try internal ajax endpoints that the Kommo frontend uses
  await tryUrl(`${base}/ajax/v1/widgets/list`, token.accessToken, "ajax widgets list");
  await tryUrl(`${base}/private/api/v2/json/widget/list`, token.accessToken, "private widget list");

  // Try sources with different params
  await tryUrl(`${base}/api/v4/sources?filter[type]=amocrmwa`, token.accessToken, "sources filter amocrmwa");
  await tryUrl(`${base}/api/v4/sources?filter[origin]=com.amocrm.amocrmwa`, token.accessToken, "sources filter origin");

  // Try Amojo channel endpoint
  const accountRes = await tryUrl(`${base}/api/v4/account?with=amojo_id`, token.accessToken, "account amojo_id");
  let amojoId = "";
  if (accountRes?.text) {
    try {
      const acc = JSON.parse(accountRes.text);
      amojoId = acc.amojo_id || "";
      console.log(`\nAmojo ID: ${amojoId}`);
    } catch {}
  }

  if (amojoId) {
    // Try Amojo endpoints
    await tryUrl(`https://amojo.kommo.com/v2/origin/custom/${amojoId}`, token.accessToken, "amojo custom origin");
    await tryUrl(`https://amojo.kommo.com/v2/origin/${amojoId}/channels`, token.accessToken, "amojo channels");
    await tryUrl(`https://amojo.kommo.com/v1/chats/channels`, token.accessToken, "amojo chats channels");
  }

  // Try the widget settings endpoint (this is what the WhatsApp Lite settings page likely uses)
  await tryUrl(`${base}/api/v4/widgets`, token.accessToken, "widgets list v4");

  // Try getting amocrmwa widget specifically
  await tryUrl(`${base}/api/v4/widgets/amocrmwa`, token.accessToken, "widget amocrmwa");
  await tryUrl(`${base}/api/v4/widgets/amocrmwa_lite`, token.accessToken, "widget amocrmwa_lite");

  // Try salesbot_designer to see configured sources
  await tryUrl(`${base}/api/v4/salesbot`, token.accessToken, "salesbot");

  // NOVA ABORDAGEM: pegar a lista de users do Kommo para ver quem é #14458127
  console.log("\n\n=== USUÁRIOS DO KOMMO ===");
  const usersRes = await tryUrl(`${base}/api/v4/users?limit=250`, token.accessToken, "users list");
  if (usersRes?.text) {
    try {
      const users = JSON.parse(usersRes.text)?._embedded?.users || [];
      console.log(`\n${users.length} usuários:`);
      for (const u of users) {
        console.log(`  #${u.id} — ${u.name} (${u.email || "sem email"}) rights:${u.rights?.is_admin ? "ADMIN" : "user"}`);
      }
    } catch {}
  }
}

main().catch(console.error);
