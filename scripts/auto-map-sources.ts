/**
 * Auto-descobre o mapeamento source_id → whatsapp_number
 * Correlaciona: source_id com user mais frequente → number registrado daquele user
 *
 * Lógica:
 * - source_id:66224 tem leads com user:14746100
 * - "Victor Delmas" está registrado com user:14746100
 * - Então source_id:66224 = "Victor Delmas"
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

async function main() {
  const TENANT_ID = "1e29dae5-38f2-4ac4-91c3-9189606f36b0";

  for (const team of ["amarela", "azul"]) {
    const token = await getToken(team);
    if (!token.subdomain || !token.accessToken) continue;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  AUTO-MAPEAMENTO: ${team.toUpperCase()} (${token.subdomain})`);
    console.log("=".repeat(60));

    // Números registrados
    const { data: numbers } = await supabase
      .from("whatsapp_numbers").select("*")
      .eq("team", team).eq("active", true).eq("tenant_id", TENANT_ID);

    if (!numbers || numbers.length === 0) { console.log("  Sem números registrados"); continue; }

    // Map user_id → number(s)
    const userToNumbers = new Map<number, typeof numbers>();
    for (const n of numbers) {
      if (!n.kommo_user_id) continue;
      if (!userToNumbers.has(n.kommo_user_id)) userToNumbers.set(n.kommo_user_id, []);
      userToNumbers.get(n.kommo_user_id)!.push(n);
    }

    // Buscar leads 14 dias com source_id
    const since = Math.floor((Date.now() - 14 * 24 * 3600 * 1000) / 1000);
    let allLeads: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(`https://${token.subdomain}.kommo.com/api/v4/leads?with=source_id&filter[created_at][from]=${since}&limit=250&page=${page}`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      if (res.status === 204) break;
      const text = await res.text();
      if (!text) break;
      const data = JSON.parse(text);
      const leads = data?._embedded?.leads || [];
      if (leads.length === 0) break;
      allLeads.push(...leads);
      await new Promise(r => setTimeout(r, 250));
    }

    console.log(`\n  ${allLeads.length} leads nos últimos 14 dias`);
    console.log(`  ${numbers.length} números registrados`);

    // Agrupar leads por source_id
    const sourceGroups = new Map<number, { users: Map<number, number>; count: number }>();
    for (const lead of allLeads) {
      if (!lead.source_id) continue;
      if (!sourceGroups.has(lead.source_id)) sourceGroups.set(lead.source_id, { users: new Map(), count: 0 });
      const g = sourceGroups.get(lead.source_id)!;
      g.count++;
      g.users.set(lead.responsible_user_id, (g.users.get(lead.responsible_user_id) || 0) + 1);
    }

    // Para cada source_id, encontrar users que SÃO números registrados
    console.log(`\n  📋 MAPEAMENTO DESCOBERTO:\n`);

    const discovered = new Map<number, any>(); // source_id → number
    const ambiguous: string[] = [];
    const noMatch: string[] = [];

    for (const [sourceId, group] of [...sourceGroups.entries()].sort((a, b) => b[1].count - a[1].count)) {
      // Checar quais users deste source são números registrados
      const matchedNumbers: Array<{ number: any; count: number }> = [];

      for (const [userId, count] of group.users) {
        const nums = userToNumbers.get(userId);
        if (nums) {
          for (const n of nums) {
            matchedNumbers.push({ number: n, count });
          }
        }
      }

      if (matchedNumbers.length === 0) {
        noMatch.push(`source_id:${sourceId} (${group.count} leads) — nenhum user registrado`);
        continue;
      }

      // Se só um número matchou, é o mapeamento
      // Se múltiplos, pegar o com mais leads
      const sorted = matchedNumbers.sort((a, b) => b.count - a.count);
      const best = sorted[0];

      if (sorted.length === 1 || best.count > sorted[1]?.count * 2) {
        discovered.set(sourceId, best.number);
        console.log(`  ✅ source_id:${sourceId} → "${best.number.kommo_source_name}" (phone: ${best.number.phone}, user: ${best.number.kommo_user_id}) — ${best.count}/${group.count} leads`);
      } else {
        ambiguous.push(`source_id:${sourceId} (${group.count} leads) — múltiplos matches: ${sorted.map(s => `${s.number.kommo_source_name}(${s.count})`).join(", ")}`);
      }
    }

    if (ambiguous.length > 0) {
      console.log(`\n  ⚠️ AMBÍGUOS (${ambiguous.length}):`);
      for (const a of ambiguous) console.log(`    ${a}`);
    }

    if (noMatch.length > 0) {
      console.log(`\n  ❓ SEM MATCH (${noMatch.length}):`);
      for (const n of noMatch) console.log(`    ${n}`);
    }

    // Números que não foram mapeados a nenhum source_id
    const mappedPhones = new Set([...discovered.values()].map(n => n.phone));
    const unmapped = numbers.filter(n => !mappedPhones.has(n.phone));
    if (unmapped.length > 0) {
      console.log(`\n  ⚠️ NÚMEROS SEM SOURCE_ID (${unmapped.length}):`);
      for (const n of unmapped) console.log(`    phone: ${n.phone} "${n.kommo_source_name}" (user: ${n.kommo_user_id})`);
    }

    // === EXEMPLO DE ROTEAMENTO ===
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  EXEMPLO DE ROTEAMENTO COM DADOS REAIS:`);
    console.log("─".repeat(60));

    const since48h = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
    let examples = 0;
    for (const lead of allLeads) {
      if (lead.created_at < since48h || !lead.source_id || examples >= 10) continue;
      const matchedNum = discovered.get(lead.source_id);
      if (!matchedNum) continue;
      if (lead.responsible_user_id === matchedNum.kommo_user_id) continue;

      console.log(`\n  Lead ${lead.id} "${lead.name}"`);
      console.log(`    source_id: ${lead.source_id}`);
      console.log(`    Match: "${matchedNum.kommo_source_name}" (phone: ${matchedNum.phone})`);
      console.log(`    Responsável ATUAL:   #${lead.responsible_user_id}`);
      console.log(`    Responsável CORRETO: #${matchedNum.kommo_user_id}`);
      console.log(`    → AÇÃO: Trocar responsável`);
      examples++;
    }

    if (examples === 0) console.log("\n  Todos os leads mapeados já estão com responsável correto!");

    // Resumo
    console.log(`\n  📊 RESUMO ${team.toUpperCase()}:`);
    console.log(`    Mapeados: ${discovered.size}/${sourceGroups.size} source_ids`);
    console.log(`    Números cobertos: ${mappedPhones.size}/${numbers.length}`);
    console.log(`    Ambíguos: ${ambiguous.length}`);
    console.log(`    Sem match: ${noMatch.length}`);
  }
}

main().catch(console.error);
