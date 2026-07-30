/**
 * 1. Salva os source_ids descobertos no banco
 * 2. Para os ambíguos com mesmo user, mapeia também
 * 3. Roda a varredura de 48h
 */
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANT_ID = "1e29dae5-38f2-4ac4-91c3-9189606f36b0";

// Mapeamentos descobertos por correlação (confirmados pelo user)
const CONFIRMED_MAPPINGS: Record<number, string> = {
  // source_id → phone do número registrado
  66208: "5519999697134",  // Gustavo Henrique
  66084: "5511922760883",  // Emilia Vitoria
  66242: "5511921098894",  // Jonas Ferraz
  66220: "5519997214537",  // Icaro Medina
  66234: "5511912533395",  // Melina Santos
  66182: "5511923083609",  // Carla Tavares
  66232: "5511916971606",  // Lívia Ortiz
  66289: "5511996006430",  // Manoel Neves
  66230: "556298553281",   // Renato Aguiar
  66224: "5519999197904",  // Victor Delmas
  66226: "5514997332034",  // Vanderson Bonfim
  66240: "5511943315196",  // Felipe Xavier
  66228: "5519998202742",  // Bernardo Prado
  66206: "5519998059277",  // Fernando Ferraz
  66214: "5511930772199",  // Marcos Aurelio
  66184: "5511997625160",  // Pablo Martins
  66218: "5511920425244",  // Pedro Augusto
  66070: "5511921124620",  // Paulo Camargo
};

// Ambíguos que compartilham user — qualquer um serve, pega o primeiro
// source_id:66086 → user 14465191 (Renata/Aline/Aline2)
// source_id:66178 → user 14465183 (Juan Carlos/Juan Carlos 2)
// source_id:66076 → user 14465155 (Daniel Torres/Marcos Silva)
// source_id:66192 → user 14465191
// source_id:66194 → user 14465191
// source_id:66180 → user 14465183
const AMBIGUOUS_MAPPINGS: Record<number, number> = {
  66086: 14465191, // ag05-saul (Renata/Aline/Aline2)
  66178: 14465183, // ag04-saul (Juan Carlos/JC2)
  66180: 14465183, // ag04-saul
  66076: 14465155, // ag02-saul (Daniel Torres/Marcos Silva)
  66192: 14465191, // ag05-saul
  66194: 14465191, // ag05-saul
};

async function getToken(team: string) {
  let subdomain = team === "amarela" ? (process.env.KOMMO_AMARELA_SUBDOMAIN || "") : (process.env.KOMMO_SUBDOMAIN || "");
  const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", TENANT_ID).single();
  if (tenant?.settings?.teams?.[team]?.subdomain) subdomain = tenant.settings.teams[team].subdomain;
  const { data: tokenRows } = await supabase.from("settings").select("key, value").eq("key", `kommo_${team}_access_token`);
  let accessToken = (tokenRows || [])[0]?.value || "";
  if (!accessToken) accessToken = team === "amarela" ? (process.env.KOMMO_AMARELA_ACCESS_TOKEN || "") : (process.env.KOMMO_ACCESS_TOKEN || "");
  return { subdomain, accessToken };
}

async function main() {
  console.log("=== SALVANDO MAPEAMENTOS + VARREDURA ===\n");

  // 1. Salvar source_ids confirmados
  console.log("PASSO 1 — Salvando source_ids no banco...\n");
  for (const [sourceId, phone] of Object.entries(CONFIRMED_MAPPINGS)) {
    const { data, error } = await supabase
      .from("whatsapp_numbers")
      .update({ kommo_source_id: Number(sourceId) })
      .eq("phone", phone)
      .eq("tenant_id", TENANT_ID)
      .select("phone, kommo_source_name, kommo_source_id");

    if (error) {
      console.log(`  ❌ Erro ao salvar source_id:${sourceId} → ${phone}: ${error.message}`);
    } else if (data && data.length > 0) {
      console.log(`  ✅ source_id:${sourceId} → "${data[0].kommo_source_name}" (${phone})`);
    }
  }

  // 2. Construir mapa completo: source_id → kommo_user_id
  const { data: numbers } = await supabase
    .from("whatsapp_numbers")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("active", true);

  // Map source_id → target user from confirmed mappings
  const sourceToUser = new Map<number, { userId: number; name: string; phone: string }>();
  for (const n of numbers || []) {
    if (n.kommo_source_id && n.kommo_user_id) {
      sourceToUser.set(n.kommo_source_id, {
        userId: n.kommo_user_id,
        name: n.kommo_source_name || n.phone,
        phone: n.phone,
      });
    }
  }

  // Add ambiguous mappings
  for (const [sourceId, userId] of Object.entries(AMBIGUOUS_MAPPINGS)) {
    const num = (numbers || []).find(n => n.kommo_user_id === userId);
    if (num) {
      sourceToUser.set(Number(sourceId), {
        userId,
        name: num.kommo_source_name || num.phone,
        phone: num.phone,
      });
    }
  }

  console.log(`\n📊 ${sourceToUser.size} source_ids mapeados para roteamento\n`);

  // 3. Varredura de 48h
  console.log("PASSO 2 — Varrendo leads das últimas 48h...\n");

  for (const team of ["amarela", "azul"]) {
    const token = await getToken(team);
    if (!token.subdomain || !token.accessToken) continue;

    console.log(`\n--- ${team.toUpperCase()} (${token.subdomain}) ---`);

    const since48h = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
    let allLeads: any[] = [];
    for (let page = 1; page <= 10; page++) {
      try {
        const res = await fetch(
          `https://${token.subdomain}.kommo.com/api/v4/leads?with=source_id,contacts,companies&filter[created_at][from]=${since48h}&limit=250&page=${page}`,
          { headers: { Authorization: `Bearer ${token.accessToken}` } }
        );
        if (res.status === 204) break;
        if (!res.ok) { console.log(`  API error: ${res.status}`); break; }
        const text = await res.text();
        if (!text) break;
        const data = JSON.parse(text);
        const leads = data?._embedded?.leads || [];
        if (leads.length === 0) break;
        allLeads.push(...leads);
        await new Promise(r => setTimeout(r, 250));
      } catch (e: any) {
        console.log(`  Fetch error page ${page}: ${e.message}`);
        break;
      }
    }

    console.log(`  ${allLeads.length} leads nas últimas 48h`);

    let routed = 0, correct = 0, noSource = 0, noMatch = 0, errors = 0;

    for (const lead of allLeads) {
      if (!lead.source_id) { noSource++; continue; }

      const target = sourceToUser.get(lead.source_id);
      if (!target) { noMatch++; continue; }

      if (lead.responsible_user_id === target.userId) { correct++; continue; }

      // ROTEAR
      console.log(`  🔄 Lead ${lead.id} "${lead.name}" | source:${lead.source_id} (${target.name}) | ${lead.responsible_user_id} → ${target.userId}`);

      try {
        // Patch lead
        const patchRes = await fetch(
          `https://${token.subdomain}.kommo.com/api/v4/leads/${lead.id}`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ responsible_user_id: target.userId }),
          }
        );
        if (!patchRes.ok) {
          console.log(`    ❌ Patch falhou: ${patchRes.status}`);
          errors++;
          continue;
        }

        // Patch contacts
        for (const c of lead._embedded?.contacts || []) {
          await fetch(`https://${token.subdomain}.kommo.com/api/v4/contacts/${c.id}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ responsible_user_id: target.userId }),
          }).catch(() => {});
          await new Promise(r => setTimeout(r, 100));
        }

        // Patch companies
        for (const c of lead._embedded?.companies || []) {
          await fetch(`https://${token.subdomain}.kommo.com/api/v4/companies/${c.id}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ responsible_user_id: target.userId }),
          }).catch(() => {});
          await new Promise(r => setTimeout(r, 100));
        }

        // Add note
        await fetch(`https://${token.subdomain}.kommo.com/api/v4/leads/${lead.id}/notes`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify([{
            note_type: "common",
            params: { text: `[SuperGerente] Roteou lead do agente #${lead.responsible_user_id} para #${target.userId} (fonte: ${target.name}, phone: ${target.phone})` },
          }]),
        }).catch(() => {});

        // Log no Supabase
        await supabase.from("whatsapp_routing_logs").insert({
          tenant_id: TENANT_ID,
          team,
          lead_id: lead.id,
          lead_name: lead.name || `Lead ${lead.id}`,
          from_user_id: lead.responsible_user_id,
          to_user_id: target.userId,
          to_user_name: target.name,
          phone_matched: target.phone,
          source_name: `source_id:${lead.source_id}`,
        });

        routed++;
        console.log(`    ✅ Roteado!`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err: any) {
        console.log(`    ❌ Erro: ${err.message}`);
        errors++;
      }
    }

    console.log(`\n  📊 ${team.toUpperCase()}: ${allLeads.length} leads | ${correct} corretos | ${routed} roteados | ${noSource} sem source | ${noMatch} sem match | ${errors} erros`);
  }

  console.log("\n✅ VARREDURA COMPLETA!");
}

main().catch(console.error);
