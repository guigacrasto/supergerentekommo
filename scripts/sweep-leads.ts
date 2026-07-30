/**
 * Script de varredura local — consulta dados e roda sweep de leads
 * Uso: npx tsx scripts/sweep-leads.ts
 */
import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SOURCE_PATTERN = /fonte|source|canal|origin|channel/i;

async function getKommoToken(tenantId: string, team: string): Promise<{ accessToken: string; subdomain: string } | null> {
  // Get tenant settings for subdomain
  const { data: tenant } = await supabase
    .from("tenants")
    .select("settings")
    .eq("id", tenantId)
    .single();

  let subdomain = "";
  if (tenant?.settings?.teams?.[team]) {
    subdomain = tenant.settings.teams[team].subdomain;
  } else if (team === "azul") {
    subdomain = process.env.KOMMO_SUBDOMAIN || "";
  } else if (team === "amarela") {
    subdomain = process.env.KOMMO_AMARELA_SUBDOMAIN || "";
  }

  if (!subdomain) return null;

  // Get stored token from settings table (these are refreshed by the server)
  const { data: tokenRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", [`kommo_${team}_access_token`, `kommo_${team}_expires_at`]);

  const tokenMap = Object.fromEntries((tokenRows || []).map((r: any) => [r.key, r.value]));
  const accessToken = tokenMap[`kommo_${team}_access_token`] || "";

  if (!accessToken) {
    console.log(`  ⚠️ Nenhum token armazenado para ${team} na tabela settings`);
    return null;
  }

  const expiresAt = tokenMap[`kommo_${team}_expires_at`];
  if (expiresAt) {
    const hoursLeft = Math.round((parseInt(expiresAt) - Date.now() / 1000) / 3600 * 10) / 10;
    console.log(`  🔑 Token ${team}: ${accessToken.slice(0, 30)}... (expira em ${hoursLeft}h)`);
  }

  return { subdomain, accessToken };
}

async function kommoFetch(subdomain: string, accessToken: string, path: string) {
  const url = `https://${subdomain}.kommo.com/api/v4${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 204) return { _embedded: { leads: [] } }; // No content
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kommo ${res.status}: ${text.slice(0, 200)}`);
  }
  const text = await res.text();
  if (!text || text.trim() === "") return { _embedded: { leads: [] } };
  return JSON.parse(text);
}

function extractSourceName(lead: any): string | null {
  const cfValues = lead.custom_fields_values;
  if (!cfValues || !Array.isArray(cfValues)) return null;
  for (const cf of cfValues) {
    if (SOURCE_PATTERN.test(cf.field_name || "")) {
      return cf.values?.[0]?.value?.toString() || null;
    }
  }
  return null;
}

function extractContactPhone(lead: any): string | null {
  const contacts = lead._embedded?.contacts || [];
  for (const contact of contacts) {
    const cfs = contact.custom_fields_values || [];
    for (const cf of cfs) {
      if (cf.field_code === "PHONE" || /phone|telefone|celular/i.test(cf.field_name || "")) {
        return cf.values?.[0]?.value?.toString() || null;
      }
    }
  }
  return null;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^0+/, "");
}

async function main() {
  console.log("=== VARREDURA DE LEADS SUPERGERENTE ===\n");

  // 1. List all registered WhatsApp numbers
  const { data: numbers, error: numErr } = await supabase
    .from("whatsapp_numbers")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (numErr) {
    console.error("Erro ao buscar números:", numErr.message);
    return;
  }

  console.log(`📱 ${numbers?.length || 0} números WhatsApp registrados:\n`);
  for (const n of numbers || []) {
    console.log(`  - Phone: ${n.phone} | Source: "${n.kommo_source_name}" | User: ${n.kommo_user_id} | Team: ${n.team} | Tenant: ${n.tenant_id}`);
  }

  // 2. Check routing queue
  const since48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: queueItems } = await supabase
    .from("whatsapp_routing_queue")
    .select("*")
    .gte("scheduled_at", since48h)
    .order("scheduled_at", { ascending: false })
    .limit(200);

  console.log(`\n📋 Fila de roteamento (48h): ${queueItems?.length || 0} itens`);
  const statusCounts: Record<string, number> = {};
  for (const q of queueItems || []) {
    statusCounts[q.status] = (statusCounts[q.status] || 0) + 1;
  }
  console.log("  Status:", JSON.stringify(statusCounts));

  // Show failed/skipped items
  const failedItems = (queueItems || []).filter(
    (q) => q.status === "failed" || q.status === "skipped"
  );
  if (failedItems.length > 0) {
    console.log(`\n❌ ${failedItems.length} itens failed/skipped:`);
    for (const item of failedItems.slice(0, 20)) {
      console.log(`  Lead ${item.lead_id} | Status: ${item.status} | Reason: ${JSON.stringify(item.result)}`);
    }
  }

  // 3. Check routing logs
  const { data: logs } = await supabase
    .from("whatsapp_routing_logs")
    .select("*")
    .gte("routed_at", since48h)
    .order("routed_at", { ascending: false })
    .limit(50);

  console.log(`\n✅ Roteamentos bem-sucedidos (48h): ${logs?.length || 0}`);
  for (const log of (logs || []).slice(0, 10)) {
    console.log(`  Lead ${log.lead_id} "${log.lead_name}" | ${log.from_user_id} → ${log.to_user_id} | Phone: ${log.phone_matched} | Source: ${log.source_name}`);
  }

  // 4. Now do the actual sweep — get recent leads from Kommo and check routing
  if (!numbers || numbers.length === 0) {
    console.log("\nNenhum número registrado, nada a varrer.");
    return;
  }

  // Group numbers by tenant+team
  const groups = new Map<string, typeof numbers>();
  for (const n of numbers) {
    const key = `${n.tenant_id}:${n.team}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  let totalChecked = 0;
  let totalRouted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const [key, teamNumbers] of groups) {
    const [tenantId, team] = key.split(":");
    console.log(`\n🔍 Varrendo ${key}...`);

    const tokenInfo = await getKommoToken(tenantId, team);
    if (!tokenInfo || !tokenInfo.subdomain || !tokenInfo.accessToken) {
      console.log(`  ⚠️ Sem credenciais para ${key}, pulando`);
      continue;
    }

    // Get leads from last 48h
    const since48hUnix = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
    let page = 1;
    let allLeads: any[] = [];

    try {
      while (page <= 5) {
        const data = await kommoFetch(
          tokenInfo.subdomain,
          tokenInfo.accessToken,
          `/leads?filter[created_at][from]=${since48hUnix}&with=contacts,companies&limit=250&page=${page}`
        );
        const leads = data?._embedded?.leads || [];
        if (leads.length === 0) break;
        allLeads.push(...leads);
        page++;
        // Rate limit
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err: any) {
      console.error(`  ❌ Erro ao buscar leads: ${err.message}`);
      totalErrors++;
      continue;
    }

    console.log(`  📊 ${allLeads.length} leads encontrados nas últimas 48h`);

    for (const lead of allLeads) {
      totalChecked++;
      const sourceName = extractSourceName(lead);

      if (!sourceName) continue; // No source, can't route

      // Try matching by source name
      let matchedNumber = teamNumbers.find(
        (n) => n.kommo_source_name && sourceName.toLowerCase().includes(n.kommo_source_name.toLowerCase())
      );

      // Fallback: match by phone
      if (!matchedNumber) {
        const contactPhone = extractContactPhone(lead);
        if (contactPhone) {
          const normalizedPhone = normalizePhone(contactPhone);
          matchedNumber = teamNumbers.find(
            (n) => normalizePhone(n.phone) === normalizedPhone
          );
        }
      }

      if (!matchedNumber) continue; // No match

      const targetUserId = matchedNumber.kommo_user_id;
      if (!targetUserId) continue; // No agent configured

      if (lead.responsible_user_id === targetUserId) {
        // Already correct
        continue;
      }

      // This lead SHOULD be routed but ISN'T
      console.log(`  🔄 Lead ${lead.id} "${lead.name}" | Source: "${sourceName}" | Current: ${lead.responsible_user_id} → Should be: ${targetUserId} (phone: ${matchedNumber.phone})`);

      // Route it!
      try {
        await kommoFetch(
          tokenInfo.subdomain,
          tokenInfo.accessToken,
          `/leads/${lead.id}`
        ); // This is GET, we need PATCH

        // PATCH lead responsible
        const patchRes = await fetch(
          `https://${tokenInfo.subdomain}.kommo.com/api/v4/leads/${lead.id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${tokenInfo.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ responsible_user_id: targetUserId }),
          }
        );

        if (!patchRes.ok) {
          const errText = await patchRes.text();
          console.error(`    ❌ Falha ao rotear lead ${lead.id}: ${errText.slice(0, 100)}`);
          totalErrors++;
          continue;
        }

        // Update contacts too
        const contacts = lead._embedded?.contacts || [];
        for (const contact of contacts) {
          try {
            await fetch(
              `https://${tokenInfo.subdomain}.kommo.com/api/v4/contacts/${contact.id}`,
              {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${tokenInfo.accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ responsible_user_id: targetUserId }),
              }
            );
          } catch {}
          await new Promise((r) => setTimeout(r, 200));
        }

        // Update companies too
        const companies = lead._embedded?.companies || [];
        for (const company of companies) {
          try {
            await fetch(
              `https://${tokenInfo.subdomain}.kommo.com/api/v4/companies/${company.id}`,
              {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${tokenInfo.accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ responsible_user_id: targetUserId }),
              }
            );
          } catch {}
          await new Promise((r) => setTimeout(r, 200));
        }

        // Add note
        try {
          await fetch(
            `https://${tokenInfo.subdomain}.kommo.com/api/v4/leads/${lead.id}/notes`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${tokenInfo.accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify([
                {
                  note_type: "common",
                  params: {
                    text: `[SuperGerente Sweep] Roteou lead do agente #${lead.responsible_user_id} para agente #${targetUserId} (fonte: ${sourceName || matchedNumber.kommo_source_name || matchedNumber.phone})`,
                  },
                },
              ]),
            }
          );
        } catch {}

        // Log in Supabase
        await supabase.from("whatsapp_routing_logs").insert({
          tenant_id: tenantId,
          team,
          lead_id: lead.id,
          lead_name: lead.name || `Lead ${lead.id}`,
          from_user_id: lead.responsible_user_id,
          to_user_id: targetUserId,
          to_user_name: matchedNumber.kommo_source_name || matchedNumber.phone,
          phone_matched: matchedNumber.phone,
          source_name: sourceName || "sweep",
        });

        totalRouted++;
        console.log(`    ✅ Roteado com sucesso!`);

        // Rate limit
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        console.error(`    ❌ Erro: ${err.message}`);
        totalErrors++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`📊 RESUMO DA VARREDURA:`);
  console.log(`  Leads verificados: ${totalChecked}`);
  console.log(`  Leads roteados: ${totalRouted}`);
  console.log(`  Leads pulados (sem match): ${totalSkipped}`);
  console.log(`  Erros: ${totalErrors}`);
  console.log(`========================================\n`);
}

main().catch(console.error);
