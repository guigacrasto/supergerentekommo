/**
 * 1. Descobre source_id para cada número registrado (via Kommo API talks/chats)
 * 2. Popula kommo_source_id na tabela whatsapp_numbers
 * 3. Roda varredura de leads das últimas 48h
 */
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getToken(team: string) {
  // Subdomain from tenant settings or env vars
  const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0").single();
  let subdomain = tenant?.settings?.teams?.[team]?.subdomain || "";
  if (!subdomain) {
    subdomain = team === "azul" ? (process.env.KOMMO_SUBDOMAIN || "") : (process.env.KOMMO_AMARELA_SUBDOMAIN || "");
  }

  // Token from settings table (refreshed by the server)
  const { data: tokenRows } = await supabase.from("settings").select("key, value").eq("key", `kommo_${team}_access_token`);
  let accessToken = (tokenRows || [])[0]?.value || "";

  // Fallback to env var
  if (!accessToken) {
    accessToken = team === "azul" ? (process.env.KOMMO_ACCESS_TOKEN || "") : (process.env.KOMMO_AMARELA_ACCESS_TOKEN || "");
  }

  console.log(`  [${team}] subdomain: ${subdomain}, token: ${accessToken ? accessToken.slice(0, 20) + "..." : "VAZIO"}`);
  return { subdomain, accessToken };
}

async function kommoGet(subdomain: string, token: string, path: string): Promise<any> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Kommo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function kommoPatch(subdomain: string, token: string, path: string, body: any): Promise<boolean> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

async function kommoPost(subdomain: string, token: string, path: string, body: any): Promise<boolean> {
  const res = await fetch(`https://${subdomain}.kommo.com/api/v4${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// ========== FASE 1: DESCOBRIR source_id DE CADA NÚMERO ==========

async function discoverSourceIds(team: string, token: { subdomain: string; accessToken: string }) {
  console.log(`\n🔍 [${team}] Descobrindo source_ids via Kommo API...`);

  // Buscar leads recentes com source_id
  const since = Math.floor((Date.now() - 14 * 24 * 3600 * 1000) / 1000); // 14 dias
  let allLeads: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await kommoGet(token.subdomain, token.accessToken,
      `/leads?with=source_id,contacts&filter[created_at][from]=${since}&limit=250&page=${page}`);
    if (!data) break;
    const leads = data?._embedded?.leads || [];
    if (leads.length === 0) break;
    allLeads.push(...leads);
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`  ${allLeads.length} leads nos últimos 14 dias`);

  // Para cada source_id, buscar o chat/talk de um lead para encontrar o telefone
  const sourceIds = [...new Set(allLeads.filter(l => l.source_id).map(l => l.source_id))];
  console.log(`  ${sourceIds.length} source_ids únicos`);

  const sourcePhoneMap = new Map<number, string>(); // source_id → phone

  for (const sourceId of sourceIds) {
    // Pegar um lead com esse source_id
    const sampleLead = allLeads.find(l => l.source_id === sourceId);
    if (!sampleLead) continue;

    try {
      // Tentar buscar talks do lead para encontrar o telefone do canal
      const talks = await kommoGet(token.subdomain, token.accessToken,
        `/talks?filter[entity_type]=leads&filter[entity_id]=${sampleLead.id}&limit=5`);

      if (talks?._embedded?.talks) {
        for (const talk of talks._embedded.talks) {
          // O talk pode ter informações sobre o canal
          if (talk.account_phone || talk.from_phone) {
            const phone = (talk.account_phone || talk.from_phone).replace(/\D/g, "");
            sourcePhoneMap.set(sourceId, phone);
            break;
          }
        }
      }
    } catch {}

    await new Promise(r => setTimeout(r, 200));
  }

  // Se talks não funcionou, tentar abordagem alternativa:
  // Buscar contatos dos leads e ver o chat thread para encontrar o número da fonte
  if (sourcePhoneMap.size === 0) {
    console.log(`  Talks API não retornou telefones. Tentando via chatbot/sources...`);

    // Tentar endpoint de chatbots/sources
    try {
      const chatbots = await kommoGet(token.subdomain, token.accessToken, "/chatbots");
      if (chatbots) {
        console.log(`  Chatbots: ${JSON.stringify(chatbots).slice(0, 500)}`);
      }
    } catch {}

    // Tentar /sources com filtros diferentes
    try {
      const sources = await kommoGet(token.subdomain, token.accessToken, "/sources?with=services");
      if (sources?._embedded?.sources) {
        for (const src of sources._embedded.sources) {
          console.log(`  Source: id=${src.id} name="${src.name}" external_id="${src.external_id || ""}" phone="${src.phone || ""}"`);
          if (src.external_id) {
            // external_id pode conter o phone
            const digits = src.external_id.replace(/\D/g, "");
            if (digits.length >= 10) {
              sourcePhoneMap.set(src.id, digits);
            }
          }
        }
      }
    } catch {}
  }

  return { allLeads, sourcePhoneMap, sourceIds };
}

// ========== FASE 2: MAPEAR source_id → NÚMERO POR NOME ==========

async function mapByName(
  team: string,
  token: { subdomain: string; accessToken: string },
  sourceIds: number[],
  allLeads: any[]
) {
  console.log(`\n📋 [${team}] Tentando mapear source_ids por nome...`);

  const { data: numbers } = await supabase
    .from("whatsapp_numbers")
    .select("*")
    .eq("team", team)
    .eq("active", true)
    .eq("tenant_id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0");

  if (!numbers || numbers.length === 0) return new Map<number, any>();

  // Buscar nome do source via eventos do lead
  const sourceNameMap = new Map<number, string>(); // source_id → source_name

  for (const sourceId of sourceIds) {
    if (sourceNameMap.has(sourceId)) continue;

    // Pegar um lead sample com esse source_id
    const sampleLead = allLeads.find(l => l.source_id === sourceId);
    if (!sampleLead) continue;

    try {
      // Eventos do lead podem mostrar o nome da fonte
      const events = await kommoGet(token.subdomain, token.accessToken,
        `/events?filter[entity]=lead&filter[entity_id]=${sampleLead.id}&filter[type]=incoming_chat_message&limit=1`);

      if (events?._embedded?.events) {
        for (const ev of events._embedded.events) {
          // O evento pode ter info da source
          const sourceInfo = ev.value_after?.[0]?.message?.source;
          if (sourceInfo) {
            sourceNameMap.set(sourceId, sourceInfo);
          }
        }
      }
    } catch {}

    await new Promise(r => setTimeout(r, 150));
  }

  // Se eventos não deram certo, tentar abordagem via nome do responsible user
  // Mas isso não é confiável. Vamos tentar outra coisa.

  // Abordagem final: usar o endpoint individual /sources/{id}
  for (const sourceId of sourceIds) {
    if (sourceNameMap.has(sourceId)) continue;

    try {
      const source = await kommoGet(token.subdomain, token.accessToken, `/sources/${sourceId}`);
      if (source?.name) {
        sourceNameMap.set(sourceId, source.name);
        console.log(`  Source ${sourceId}: "${source.name}" (external_id: ${source.external_id || "?"})`);
      }
    } catch (e: any) {
      // 404 ou outro erro — pular
    }

    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`  ${sourceNameMap.size} source names descobertos`);

  // Agora fazer match: source_name → kommo_source_name do número registrado
  const sourceToNumber = new Map<number, any>(); // source_id → whatsapp_number row

  for (const [sourceId, sourceName] of sourceNameMap) {
    const lowerName = sourceName.toLowerCase();
    const matched = numbers.find(n => {
      if (!n.kommo_source_name) return false;
      const regName = n.kommo_source_name.toLowerCase();
      return lowerName.includes(regName) || regName.includes(lowerName);
    });

    if (matched) {
      sourceToNumber.set(sourceId, matched);
      console.log(`  ✅ source_id:${sourceId} "${sourceName}" → phone:${matched.phone} (user:${matched.kommo_user_id})`);
    }
  }

  // Salvar kommo_source_id no banco
  for (const [sourceId, num] of sourceToNumber) {
    await supabase
      .from("whatsapp_numbers")
      .update({ kommo_source_id: sourceId })
      .eq("id", num.id);
  }

  console.log(`  ${sourceToNumber.size} mapeamentos salvos no banco`);

  return sourceToNumber;
}

// ========== FASE 3: VARREDURA ==========

async function sweepLeads(
  team: string,
  token: { subdomain: string; accessToken: string },
  allLeads: any[],
  sourceToNumber: Map<number, any>
) {
  console.log(`\n🔄 [${team}] Varrendo ${allLeads.length} leads...`);

  // Filtrar só últimas 48h
  const since48h = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
  const recentLeads = allLeads.filter(l => l.created_at >= since48h);
  console.log(`  ${recentLeads.length} leads nas últimas 48h`);

  // Também carregar números com source_id já salvo
  const { data: numbers } = await supabase
    .from("whatsapp_numbers")
    .select("*")
    .eq("team", team)
    .eq("active", true)
    .eq("tenant_id", "1e29dae5-38f2-4ac4-91c3-9189606f36b0");

  // Build source_id → number map from DB
  const dbSourceMap = new Map<number, any>();
  for (const n of numbers || []) {
    if (n.kommo_source_id) {
      dbSourceMap.set(n.kommo_source_id, n);
    }
  }

  // Merge with discovered map
  for (const [sid, num] of sourceToNumber) {
    if (!dbSourceMap.has(sid)) dbSourceMap.set(sid, num);
  }

  console.log(`  ${dbSourceMap.size} source_ids mapeados para números`);

  let routed = 0;
  let alreadyCorrect = 0;
  let noMatch = 0;
  let noSourceId = 0;
  let errors = 0;

  for (const lead of recentLeads) {
    if (!lead.source_id) {
      noSourceId++;
      continue;
    }

    const matchedNumber = dbSourceMap.get(lead.source_id);
    if (!matchedNumber) {
      noMatch++;
      continue;
    }

    const targetUserId = matchedNumber.kommo_user_id;
    if (!targetUserId) continue;

    if (lead.responsible_user_id === targetUserId) {
      alreadyCorrect++;
      continue;
    }

    // Este lead precisa ser roteado!
    console.log(`  🔄 Lead ${lead.id} "${lead.name}" | source_id:${lead.source_id} | ${lead.responsible_user_id} → ${targetUserId} (${matchedNumber.kommo_source_name})`);

    try {
      // Patch lead
      const ok = await kommoPatch(token.subdomain, token.accessToken,
        `/leads/${lead.id}`, { responsible_user_id: targetUserId });

      if (!ok) {
        console.log(`    ❌ Falha ao rotear lead`);
        errors++;
        continue;
      }

      // Patch contacts
      const contacts = lead._embedded?.contacts || [];
      for (const c of contacts) {
        await kommoPatch(token.subdomain, token.accessToken,
          `/contacts/${c.id}`, { responsible_user_id: targetUserId }).catch(() => {});
        await new Promise(r => setTimeout(r, 150));
      }

      // Patch companies
      const companies = lead._embedded?.companies || [];
      for (const c of companies) {
        await kommoPatch(token.subdomain, token.accessToken,
          `/companies/${c.id}`, { responsible_user_id: targetUserId }).catch(() => {});
        await new Promise(r => setTimeout(r, 150));
      }

      // Add note
      await kommoPost(token.subdomain, token.accessToken,
        `/leads/${lead.id}/notes`, [{
          note_type: "common",
          params: {
            text: `[SuperGerente Sweep] Roteou lead do agente #${lead.responsible_user_id} para agente #${targetUserId} (fonte: ${matchedNumber.kommo_source_name}, phone: ${matchedNumber.phone})`,
          },
        }]).catch(() => {});

      // Log in Supabase
      await supabase.from("whatsapp_routing_logs").insert({
        tenant_id: "1e29dae5-38f2-4ac4-91c3-9189606f36b0",
        team,
        lead_id: lead.id,
        lead_name: lead.name || `Lead ${lead.id}`,
        from_user_id: lead.responsible_user_id,
        to_user_id: targetUserId,
        to_user_name: matchedNumber.kommo_source_name || matchedNumber.phone,
        phone_matched: matchedNumber.phone,
        source_name: matchedNumber.kommo_source_name || "sweep",
      });

      routed++;
      console.log(`    ✅ Roteado!`);

      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      console.error(`    ❌ Erro: ${err.message}`);
      errors++;
    }
  }

  return { routed, alreadyCorrect, noMatch, noSourceId, errors, total: recentLeads.length };
}

// ========== MAIN ==========

async function main() {
  console.log("=== DISCOVER + SWEEP — SUPERGERENTE ===\n");

  for (const team of ["amarela", "azul"]) {
    const token = await getToken(team);
    if (!token.subdomain || !token.accessToken) {
      console.log(`⚠️ ${team}: sem credenciais, pulando`);
      continue;
    }

    console.log(`\n${"=".repeat(50)}`);
    console.log(`EQUIPE: ${team.toUpperCase()} (${token.subdomain})`);
    console.log("=".repeat(50));

    // Fase 1: Descobrir source_ids
    const { allLeads, sourcePhoneMap, sourceIds } = await discoverSourceIds(team, token);

    // Fase 2: Mapear por nome
    const sourceToNumber = await mapByName(team, token, sourceIds, allLeads);

    // Fase 3: Varredura
    const result = await sweepLeads(team, token, allLeads, sourceToNumber);

    console.log(`\n📊 [${team}] RESULTADO:`);
    console.log(`  Total leads (48h): ${result.total}`);
    console.log(`  Já correto: ${result.alreadyCorrect}`);
    console.log(`  Roteados agora: ${result.routed}`);
    console.log(`  Sem source_id: ${result.noSourceId}`);
    console.log(`  Sem match: ${result.noMatch}`);
    console.log(`  Erros: ${result.errors}`);
  }

  console.log("\n✅ VARREDURA COMPLETA!");
}

main().catch(console.error);
