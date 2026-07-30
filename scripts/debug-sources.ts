/**
 * Debug — mapear source_id → número de telefone
 */
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getToken(team: string) {
  const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0").single();
  const subdomain = tenant?.settings?.teams?.[team]?.subdomain || "";
  const { data: tokenRows } = await supabase.from("settings").select("key, value").eq("key", `kommo_${team}_access_token`);
  return { subdomain, accessToken: (tokenRows || [])[0]?.value || "" };
}

async function main() {
  // 1. Mostrar kommo_source_id dos números registrados
  const { data: numbers } = await supabase
    .from("whatsapp_numbers")
    .select("id, phone, kommo_source_name, kommo_source_id, kommo_user_id, team")
    .eq("active", true)
    .order("team");

  console.log("=== WHATSAPP NUMBERS — kommo_source_id ===\n");
  for (const n of numbers || []) {
    console.log(`  ${n.team} | phone:${n.phone} | source:"${n.kommo_source_name}" | source_id:${n.kommo_source_id || "NULL"} | user:${n.kommo_user_id}`);
  }

  // 2. Para cada team, pegar leads recentes e mapear source_id → qual número corresponde
  for (const team of ["amarela", "azul"]) {
    const token = await getToken(team);
    if (!token.subdomain) continue;

    console.log(`\n=== MAPEAMENTO SOURCE_ID — ${team} (${token.subdomain}) ===`);

    // Pegar leads com source_id
    const since = Math.floor((Date.now() - 7 * 24 * 3600 * 1000) / 1000); // 7 dias
    let allLeads: any[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(
        `https://${token.subdomain}.kommo.com/api/v4/leads?with=source_id&filter[created_at][from]=${since}&limit=250&page=${page}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      if (res.status === 204) break;
      const text = await res.text();
      if (!text) break;
      const data = JSON.parse(text);
      const leads = data?._embedded?.leads || [];
      if (leads.length === 0) break;
      allLeads.push(...leads);
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`  ${allLeads.length} leads nos últimos 7 dias`);

    // Agrupar por source_id
    const sourceMap = new Map<number, { count: number; leadIds: number[]; responsible: Map<number, number> }>();
    for (const lead of allLeads) {
      const sid = lead.source_id;
      if (!sid) continue;
      if (!sourceMap.has(sid)) sourceMap.set(sid, { count: 0, leadIds: [], responsible: new Map() });
      const entry = sourceMap.get(sid)!;
      entry.count++;
      if (entry.leadIds.length < 3) entry.leadIds.push(lead.id);
      const resp = lead.responsible_user_id;
      entry.responsible.set(resp, (entry.responsible.get(resp) || 0) + 1);
    }

    console.log(`  ${sourceMap.size} source_ids únicos:\n`);

    const teamNumbers = (numbers || []).filter(n => n.team === team);

    for (const [sourceId, info] of [...sourceMap.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const matchedNum = teamNumbers.find(n => n.kommo_source_id === sourceId);
      const respStr = [...info.responsible.entries()].map(([uid, cnt]) => `user:${uid}(${cnt})`).join(", ");
      console.log(`  source_id:${sourceId} — ${info.count} leads — resp: [${respStr}]${matchedNum ? ` → MAPEADO para phone:${matchedNum.phone}` : " → NÃO MAPEADO"}`);
    }

    // Sem source_id
    const noSource = allLeads.filter(l => !l.source_id);
    console.log(`\n  ${noSource.length} leads SEM source_id`);
  }
}

main().catch(console.error);
