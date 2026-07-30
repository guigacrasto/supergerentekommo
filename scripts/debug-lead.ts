/**
 * Debug — mostra estrutura COMPLETA do lead para entender onde fica o número do WhatsApp
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getToken(team: string) {
  const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0").single();
  const subdomain = tenant?.settings?.teams?.[team]?.subdomain || (team === "azul" ? process.env.KOMMO_SUBDOMAIN : process.env.KOMMO_AMARELA_SUBDOMAIN) || "";
  const { data: tokenRows } = await supabase.from("settings").select("key, value").in("key", [`kommo_${team}_access_token`]);
  const accessToken = (tokenRows || []).find((r: any) => r.key === `kommo_${team}_access_token`)?.value || "";
  return { subdomain, accessToken };
}

async function main() {
  const leadId = process.argv[2] || "25216757";
  const team = "amarela";
  const token = await getToken(team);

  console.log(`=== LEAD ${leadId} — ESTRUTURA COMPLETA ===\n`);

  // 1. Lead completo com contacts
  const leadRes = await fetch(
    `https://${token.subdomain}.kommo.com/api/v4/leads/${leadId}?with=contacts,companies,source_id`,
    { headers: { Authorization: `Bearer ${token.accessToken}` } }
  );
  const lead = await leadRes.json();

  // Mostrar TODOS os campos de primeiro nível (excluindo _embedded que é grande)
  console.log("📋 Campos do lead:");
  for (const [key, val] of Object.entries(lead)) {
    if (key === "_embedded" || key === "custom_fields_values") continue;
    console.log(`  ${key}: ${JSON.stringify(val)}`);
  }

  console.log(`\n📋 custom_fields_values: ${JSON.stringify(lead.custom_fields_values, null, 2)}`);

  // _embedded
  console.log(`\n📋 _embedded keys: ${Object.keys(lead._embedded || {}).join(", ")}`);
  if (lead._embedded?.source) {
    console.log(`  source: ${JSON.stringify(lead._embedded.source, null, 2)}`);
  }

  // Contacts com detalhes
  const contacts = lead._embedded?.contacts || [];
  console.log(`\n👥 ${contacts.length} contato(s):`);
  for (const c of contacts) {
    // Buscar detalhes do contato
    const cRes = await fetch(
      `https://${token.subdomain}.kommo.com/api/v4/contacts/${c.id}`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );
    const contact = await cRes.json();
    console.log(`\n  Contato ${contact.id}: ${contact.name}`);
    console.log(`  responsible: ${contact.responsible_user_id}`);
    for (const cf of contact.custom_fields_values || []) {
      console.log(`  field: "${cf.field_name}" (${cf.field_code || cf.field_id}) = ${JSON.stringify(cf.values?.map((v: any) => v.value))}`);
    }
  }

  // 2. Verificar o source do lead via API talks/chats
  console.log(`\n\n=== BUSCANDO FONTE/CANAL DO LEAD ===`);

  // Tentar /api/v4/leads/{id}/chats
  try {
    const chatsRes = await fetch(
      `https://${token.subdomain}.kommo.com/api/v4/leads/${leadId}/chats`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );
    if (chatsRes.ok) {
      const chatsText = await chatsRes.text();
      if (chatsText) {
        console.log(`\n💬 Chats do lead: ${chatsText.slice(0, 2000)}`);
      }
    } else {
      console.log(`  Chats: ${chatsRes.status}`);
    }
  } catch (e: any) { console.log(`  Chats error: ${e.message}`); }

  // 3. Buscar sources do Kommo
  console.log(`\n\n=== SOURCES DO KOMMO ===`);
  try {
    const srcRes = await fetch(
      `https://${token.subdomain}.kommo.com/api/v4/sources`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );
    if (srcRes.ok) {
      const srcText = await srcRes.text();
      if (srcText) {
        const srcData = JSON.parse(srcText);
        const sources = srcData?._embedded?.sources || [];
        console.log(`  ${sources.length} sources encontrados`);
        for (const s of sources) {
          console.log(`  - id:${s.id} name:"${s.name}" external_id:"${s.external_id || ""}" type:${s.type || "?"}`);
          if (s.services) {
            for (const svc of s.services) {
              console.log(`    service: ${JSON.stringify(svc)}`);
            }
          }
        }
      } else {
        console.log("  Resposta vazia");
      }
    } else {
      console.log(`  Sources: ${srcRes.status}`);
    }
  } catch (e: any) { console.log(`  Sources error: ${e.message}`); }

  // 4. Buscar talks (mensagens) do lead
  console.log(`\n\n=== TALKS / EVENTS ===`);
  try {
    const talksRes = await fetch(
      `https://${token.subdomain}.kommo.com/api/v4/events?filter[entity]=lead&filter[entity_id]=${leadId}&limit=5`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    );
    if (talksRes.ok) {
      const talksText = await talksRes.text();
      if (talksText) {
        const talksData = JSON.parse(talksText);
        const events = talksData?._embedded?.events || [];
        console.log(`  ${events.length} eventos:`);
        for (const ev of events) {
          console.log(`  - type:${ev.type} created:${new Date(ev.created_at * 1000).toISOString()}`);
          if (ev.value_after) console.log(`    value_after: ${JSON.stringify(ev.value_after).slice(0, 300)}`);
        }
      }
    }
  } catch (e: any) { console.log(`  Events error: ${e.message}`); }

  // 5. Amostra de 3 leads com custom_fields para comparar
  console.log(`\n\n=== AMOSTRA: 3 LEADS COM CUSTOM FIELDS ===`);
  const since = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
  const sampleRes = await fetch(
    `https://${token.subdomain}.kommo.com/api/v4/leads?filter[created_at][from]=${since}&limit=50&page=1`,
    { headers: { Authorization: `Bearer ${token.accessToken}` } }
  );
  if (sampleRes.ok) {
    const sampleText = await sampleRes.text();
    if (sampleText) {
      const sampleLeads = JSON.parse(sampleText)?._embedded?.leads || [];
      let shown = 0;
      for (const sl of sampleLeads) {
        if (sl.custom_fields_values && sl.custom_fields_values.length > 0) {
          console.log(`\n  Lead ${sl.id} "${sl.name}" (resp:${sl.responsible_user_id}, source_id:${(sl as any).source_id || "?"})`);
          for (const cf of sl.custom_fields_values) {
            console.log(`    "${cf.field_name}" = ${JSON.stringify(cf.values?.map((v: any) => v.value))}`);
          }
          shown++;
          if (shown >= 3) break;
        }
      }
      if (shown === 0) console.log("  Nenhum lead com custom fields encontrado!");

      // Also show source_id of first 10 leads
      console.log(`\n  source_id dos primeiros 10 leads:`);
      for (const sl of sampleLeads.slice(0, 10)) {
        console.log(`    Lead ${sl.id} "${sl.name}" — source_id: ${(sl as any).source_id || "N/A"}, pipeline: ${sl.pipeline_id}`);
      }
    }
  }
}

main().catch(console.error);
