/**
 * Backup diário de leads do Kommo → Google Sheets
 * Uma planilha por conta (azul / amarela)
 */
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANT_ID = "1e29dae5-38f2-4ac4-91c3-9189606f36b0";

const SHEETS: Record<string, string> = {
  azul: "1k2kxUaB1FyFWKKHd71v5b6LtMhlSk_q3wUKZR9OR5D8",
  amarela: "1dyEgqslq4kp1UXYNlJ99aiXinzkSi-oOgzivSQ16VN0",
};

const HEADERS = [
  "ID", "Nome", "Telefone", "Email", "Responsável ID", "Responsável",
  "Pipeline", "Status", "Valor (R$)", "Source ID", "Tags",
  "Criado em", "Atualizado em",
];

async function getToken(team: string) {
  const subdomain = team === "amarela"
    ? (process.env.KOMMO_AMARELA_SUBDOMAIN || "")
    : (process.env.KOMMO_SUBDOMAIN || "");
  const { data: tokenRows } = await supabase
    .from("settings").select("key, value")
    .eq("key", `kommo_${team}_access_token`);
  const accessToken = (tokenRows || [])[0]?.value || "";
  return { subdomain, accessToken };
}

async function fetchAllLeads(subdomain: string, accessToken: string) {
  const allLeads: any[] = [];
  for (let page = 1; page <= 1000; page++) {
    if (page % 10 === 1) console.log(`  Fetching page ${page}...`);
    try {
      const res = await fetch(
        `https://${subdomain}.kommo.com/api/v4/leads?with=contacts,source_id,custom_fields_values&limit=250&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res.status === 204) break;
      if (!res.ok) { console.log(`  API error: ${res.status}`); break; }
      const text = await res.text();
      if (!text) break;
      const data = JSON.parse(text);
      const leads = data?._embedded?.leads || [];
      if (leads.length === 0) break;
      allLeads.push(...leads);
      if (leads.length < 250) break;
      await new Promise(r => setTimeout(r, 250));
    } catch (e: any) {
      console.log(`  Fetch error page ${page}: ${e.message}`);
      break;
    }
  }
  return allLeads;
}

async function fetchUsers(subdomain: string, accessToken: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/users?limit=250`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    for (const u of data?._embedded?.users || []) {
      map.set(u.id, u.name);
    }
  } catch {}
  return map;
}

async function fetchPipelines(subdomain: string, accessToken: string) {
  const pipelineMap = new Map<number, string>();
  const statusMap = new Map<number, string>();
  try {
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    for (const p of data?._embedded?.pipelines || []) {
      pipelineMap.set(p.id, p.name);
      for (const s of p._embedded?.statuses || []) {
        statusMap.set(s.id, s.name);
      }
    }
  } catch {}
  return { pipelineMap, statusMap };
}

function extractContactField(lead: any, fieldCode: string): string {
  const contacts = lead._embedded?.contacts || [];
  for (const c of contacts) {
    const cfs = c.custom_fields_values || [];
    for (const cf of cfs) {
      if (cf.field_code === fieldCode) {
        return cf.values?.[0]?.value?.toString() || "";
      }
    }
  }
  return "";
}

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function extractTags(lead: any): string {
  const tags = lead._embedded?.tags || [];
  return tags.map((t: any) => t.name).join(", ");
}

async function getSheetsClient() {
  const keyPath = path.resolve(__dirname, "../google-service-account.json");
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function writeToSheet(sheets: any, spreadsheetId: string, rows: string[][]) {
  // Clear existing data
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "A:Z",
  });

  // Write header + rows
  const allRows = [HEADERS, ...rows];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: allRows },
  });

  // Format header row (bold, frozen)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.2, green: 0.2, blue: 0.3 },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
      ],
    },
  });
}

async function main() {
  console.log("=== BACKUP DE LEADS → GOOGLE SHEETS ===\n");
  const sheets = await getSheetsClient();

  for (const team of ["azul", "amarela"]) {
    const spreadsheetId = SHEETS[team];
    if (!spreadsheetId) continue;

    console.log(`\n--- ${team.toUpperCase()} ---`);
    const token = await getToken(team);
    if (!token.subdomain || !token.accessToken) {
      console.log("  Token não encontrado, pulando...");
      continue;
    }

    // Fetch data
    const [allLeads, userMap, { pipelineMap, statusMap }] = await Promise.all([
      fetchAllLeads(token.subdomain, token.accessToken),
      fetchUsers(token.subdomain, token.accessToken),
      fetchPipelines(token.subdomain, token.accessToken),
    ]);

    console.log(`  ${allLeads.length} leads encontrados`);
    console.log(`  ${userMap.size} usuários | ${pipelineMap.size} pipelines`);

    // Build rows
    const rows: string[][] = allLeads.map(lead => [
      String(lead.id),
      lead.name || "",
      extractContactField(lead, "PHONE"),
      extractContactField(lead, "EMAIL"),
      String(lead.responsible_user_id || ""),
      userMap.get(lead.responsible_user_id) || `#${lead.responsible_user_id}`,
      pipelineMap.get(lead.pipeline_id) || `#${lead.pipeline_id}`,
      statusMap.get(lead.status_id) || `#${lead.status_id}`,
      lead.price ? String(lead.price) : "",
      lead.source_id ? String(lead.source_id) : "",
      extractTags(lead),
      formatDate(lead.created_at),
      formatDate(lead.updated_at),
    ]);

    // Write to Google Sheets
    console.log(`  Escrevendo ${rows.length} linhas na planilha...`);
    await writeToSheet(sheets, spreadsheetId, rows);
    console.log(`  ✅ Planilha atualizada!`);
  }

  console.log("\n✅ BACKUP COMPLETO!");
}

main().catch(console.error);
