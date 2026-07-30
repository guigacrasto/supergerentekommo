/**
 * Tenta descobrir source_ids via endpoints internos do Kommo
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

async function tryFetch(url: string, token: string, label: string) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    const preview = text.slice(0, 600);
    console.log(`${label} [${res.status}]: ${preview}\n`);
    if (res.ok && text) return JSON.parse(text);
  } catch (e: any) {
    console.log(`${label}: ${e.message}\n`);
  }
  return null;
}

async function main() {
  const token = await getToken("amarela");
  const base = `https://${token.subdomain}.kommo.com`;

  console.log("=== BUSCANDO SOURCE_IDS VIA KOMMO API ===\n");

  // 1. Channels endpoint
  await tryFetch(`${base}/api/v4/channels`, token.accessToken, "GET /channels");

  // 2. Sources com paginação
  await tryFetch(`${base}/api/v4/sources?limit=250`, token.accessToken, "GET /sources?limit=250");

  // 3. Widgets
  await tryFetch(`${base}/api/v4/widgets`, token.accessToken, "GET /widgets");

  // 4. Chatbots
  await tryFetch(`${base}/api/v4/chatbots`, token.accessToken, "GET /chatbots");

  // 5. Tentativa pelo Amojo
  await tryFetch(`${base}/api/v4/chats/templates`, token.accessToken, "GET /chats/templates");

  // 6. Buscar talks com source_ids distintos e comparar com números
  console.log("=== ABORDAGEM: TALKS → SOURCE_IDs DISTINTOS ===\n");

  const { data: numbers } = await supabase
    .from("whatsapp_numbers").select("*")
    .eq("team", "amarela").eq("active", true).eq("tenant_id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0");

  // Buscar talks recentes, cada um tem source_id
  let allTalks: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await tryFetch(
      `${base}/api/v4/talks?limit=250&page=${page}&filter[is_in_work]=true`,
      token.accessToken, `GET /talks page=${page}`
    );
    if (!data?._embedded?.talks?.length) break;
    allTalks.push(...data._embedded.talks);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n${allTalks.length} talks ativos encontrados`);

  // source_ids únicos dos talks
  const talkSourceIds = [...new Set(allTalks.map(t => t.source_id).filter(Boolean))];
  console.log(`${talkSourceIds.length} source_ids únicos nos talks: ${talkSourceIds.join(", ")}\n`);

  // Para cada source_id, encontrar o contato associado e ver se o telefone do contato
  // nos leva de volta ao canal
  // NA VERDADE: vamos ver se contatos dos talks têm algum padrão

  // Agrupamento: source_id → set de contact_ids
  const sourceContacts = new Map<number, Set<number>>();
  for (const talk of allTalks) {
    if (!talk.source_id) continue;
    if (!sourceContacts.has(talk.source_id)) sourceContacts.set(talk.source_id, new Set());
    sourceContacts.get(talk.source_id)!.add(talk.contact_id);
  }

  console.log("Source_id → quantidade de contatos:");
  for (const [sid, contacts] of [...sourceContacts.entries()].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`  source_id:${sid} → ${contacts.size} contatos`);
  }

  // Verificar se os source_ids menores (66xxx) correspondem a WhatsApp individuais
  // Para isso, buscar 1 lead com cada source_id e verificar a lista de responsáveis
  console.log("\n=== CORRELAÇÃO SOURCE_ID → NÚMERO (via talks + leads) ===\n");

  // Para cada source_id dos talks, pegar 1 talk e ver o lead associado
  for (const sid of talkSourceIds.slice(0, 35)) {
    const talksForSource = allTalks.filter(t => t.source_id === sid);
    if (talksForSource.length === 0) continue;

    // Pegar o lead do primeiro talk
    const firstTalk = talksForSource[0];
    if (!firstTalk.entity_id || firstTalk.entity_type !== "lead") continue;

    const leadData = await tryFetch(
      `${base}/api/v4/leads/${firstTalk.entity_id}?with=source_id`,
      token.accessToken, `  Lead ${firstTalk.entity_id} (source_id:${sid})`
    );

    if (leadData) {
      // Verificar se o responsible_user_id bate com algum número
      const matchedNum = (numbers || []).find(n => n.kommo_user_id === leadData.responsible_user_id);
      if (matchedNum) {
        console.log(`  → Match! user:${leadData.responsible_user_id} = "${matchedNum.kommo_source_name}" (phone:${matchedNum.phone})\n`);
      }
    }

    await new Promise(r => setTimeout(r, 150));
  }
}

main().catch(console.error);
