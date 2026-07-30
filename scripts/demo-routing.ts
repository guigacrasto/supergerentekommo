/**
 * DEMO — Mostra como o roteamento vai funcionar com dados reais
 * Sem alterar nada, só leitura
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

async function kommoGet(sub: string, token: string, path: string) {
  const res = await fetch(`https://${sub}.kommo.com/api/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 204) return null;
  if (!res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const team = "amarela";
  const token = await getToken(team);

  console.log("============================================================");
  console.log("  DEMO: COMO O WHATSAPP ROUTING VAI FUNCIONAR");
  console.log("============================================================\n");

  // 1. Números registrados
  const { data: numbers } = await supabase
    .from("whatsapp_numbers")
    .select("*")
    .eq("team", team)
    .eq("active", true)
    .eq("tenant_id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0");

  console.log("PASSO 1 — Números registrados no SuperGerente:\n");
  for (const n of (numbers || []).slice(0, 5)) {
    console.log(`  📱 ${n.phone} → "${n.kommo_source_name}" → agente #${n.kommo_user_id}`);
  }
  console.log(`  ... (${numbers?.length} total)\n`);

  // 2. Pegar o lead 25216757 (o exemplo que o user mandou)
  console.log("------------------------------------------------------------");
  console.log("PASSO 2 — Lead 25216757 (exemplo que você mandou):\n");

  const lead = await kommoGet(token.subdomain, token.accessToken, `/leads/25216757?with=contacts,source_id`);
  if (!lead) {
    console.log("  ❌ Não consegui buscar o lead");
    return;
  }

  console.log(`  Lead: ${lead.name} (ID: ${lead.id})`);
  console.log(`  source_id: ${lead.source_id}`);
  console.log(`  responsible_user_id atual: ${lead.responsible_user_id}`);
  console.log(`  custom_fields_values: ${lead.custom_fields_values ? "TEM" : "NULL (vazio!)"}`);

  // 3. Tentar buscar detalhes da source
  console.log(`\n------------------------------------------------------------`);
  console.log(`PASSO 3 — Buscar fonte #${lead.source_id} no Kommo:\n`);

  const source = await kommoGet(token.subdomain, token.accessToken, `/sources/${lead.source_id}`);
  if (source) {
    console.log(`  ✅ Fonte encontrada: "${source.name}" (id: ${source.id})`);
    console.log(`     external_id: ${source.external_id || "N/A"}`);
    console.log(`     Dados completos: ${JSON.stringify(source).slice(0, 500)}`);
  } else {
    console.log(`  ❌ API /sources/${lead.source_id} não retornou dados`);
    console.log(`  (Normal para fontes WhatsApp gerenciadas pelo Amojo)`);
  }

  // 4. Mostrar o matching
  console.log(`\n------------------------------------------------------------`);
  console.log(`PASSO 4 — MATCHING: source_id ${lead.source_id} → qual número?\n`);

  console.log(`  LÓGICA NOVA (por source_id):`);
  const matchById = (numbers || []).find(n => n.kommo_source_id === lead.source_id);
  if (matchById) {
    console.log(`  ✅ Match direto! source_id ${lead.source_id} = phone ${matchById.phone} (${matchById.kommo_source_name}) → agente #${matchById.kommo_user_id}`);
  } else {
    console.log(`  ⚠️ Nenhum número tem kommo_source_id = ${lead.source_id} (todos estão NULL)`);
    console.log(`  → Precisamos descobrir e salvar esse mapeamento`);
  }

  // 5. Agora pegar vários source_ids e tentar descobrir seus nomes
  console.log(`\n------------------------------------------------------------`);
  console.log(`PASSO 5 — Descobrindo nomes dos source_ids via API:\n`);

  // Buscar leads recentes com source_id
  const since48h = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
  let recentLeads: any[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = await kommoGet(token.subdomain, token.accessToken,
      `/leads?with=source_id&filter[created_at][from]=${since48h}&limit=250&page=${page}`);
    if (!data) break;
    const leads = data?._embedded?.leads || [];
    if (leads.length === 0) break;
    recentLeads.push(...leads);
    await new Promise(r => setTimeout(r, 200));
  }

  const uniqueSourceIds = [...new Set(recentLeads.filter(l => l.source_id).map(l => l.source_id as number))];
  console.log(`  ${recentLeads.length} leads recentes, ${uniqueSourceIds.length} source_ids únicos\n`);

  // Tentar buscar nome de cada source_id
  const discoveredSources = new Map<number, string>();
  for (const sid of uniqueSourceIds.slice(0, 40)) {
    const src = await kommoGet(token.subdomain, token.accessToken, `/sources/${sid}`);
    if (src?.name) {
      discoveredSources.set(sid, src.name);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`  ${discoveredSources.size} fontes com nome descoberto:\n`);

  // Mostrar matching
  let matchCount = 0;
  let noMatchList: string[] = [];

  for (const [sid, name] of discoveredSources) {
    const lowerName = name.toLowerCase();
    const matched = (numbers || []).find(n => {
      if (!n.kommo_source_name) return false;
      const regName = n.kommo_source_name.toLowerCase();
      return lowerName.includes(regName) || regName.includes(lowerName);
    });

    const leadsWithThis = recentLeads.filter(l => l.source_id === sid).length;

    if (matched) {
      matchCount++;
      console.log(`  ✅ source_id:${sid} "${name}" → phone:${matched.phone} agente:#${matched.kommo_user_id} (${leadsWithThis} leads)`);
    } else {
      noMatchList.push(`source_id:${sid} "${name}" (${leadsWithThis} leads)`);
    }
  }

  if (noMatchList.length > 0) {
    console.log(`\n  ❓ Fontes SEM match (${noMatchList.length}):`);
    for (const item of noMatchList) {
      console.log(`     ${item}`);
    }
  }

  // 6. Exemplo completo de roteamento
  console.log(`\n------------------------------------------------------------`);
  console.log(`PASSO 6 — EXEMPLO DE ROTEAMENTO (sem executar):\n`);

  let examples = 0;
  for (const l of recentLeads) {
    if (!l.source_id || examples >= 5) continue;
    const srcName = discoveredSources.get(l.source_id);
    if (!srcName) continue;

    const matched = (numbers || []).find(n => {
      if (!n.kommo_source_name) return false;
      const regName = n.kommo_source_name.toLowerCase();
      return srcName.toLowerCase().includes(regName) || regName.includes(srcName.toLowerCase());
    });

    if (!matched) continue;
    if (l.responsible_user_id === matched.kommo_user_id) continue; // já correto

    console.log(`  Lead ${l.id} "${l.name}"`);
    console.log(`    source_id: ${l.source_id} → fonte: "${srcName}"`);
    console.log(`    Match: phone ${matched.phone} (${matched.kommo_source_name})`);
    console.log(`    Responsável ATUAL: #${l.responsible_user_id}`);
    console.log(`    Responsável CORRETO: #${matched.kommo_user_id}`);
    console.log(`    → AÇÃO: Trocar ${l.responsible_user_id} → ${matched.kommo_user_id}`);
    console.log();
    examples++;
  }

  if (examples === 0) {
    console.log("  Nenhum lead encontrado que precise de roteamento nos matches descobertos.");
  }

  console.log("============================================================");
  console.log("  FIM DA DEMO — Nada foi alterado");
  console.log("============================================================");
}

main().catch(console.error);
