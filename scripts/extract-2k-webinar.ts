/**
 * Extrai 2k leads do Kommo (azul/ferramentasempresa001) que:
 * 1. NUNCA receberam disparo (não estão em nenhuma lista)
 * 2. NÃO são vendas ganhas (status 142 = won)
 * 3. Priorizados por melhor perfil para webinário de venda
 *
 * Rodar: npx tsx scripts/extract-2k-webinar.ts
 */
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ============================
// 1. Carregar telefones de TODAS as listas de disparo
// ============================
function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  let s = phone.replace(/[^\d]/g, "");
  if (s.length >= 12 && s.startsWith("55")) s = s.slice(2);
  if (s.length === 11 && s[0] === "0") s = s.slice(1);
  return s.length >= 10 ? s : null;
}

function loadXlsxPhones(filePath: string): Set<string> {
  const phones = new Set<string>();
  try {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<any>(ws, { header: 1 });

    const headers = (data[0] || []).map((h: any) => String(h || "").toLowerCase());
    let phoneIdx = headers.findIndex((h: string) =>
      h.includes("telefone") || h.includes("phone") || h.includes("celular")
    );

    if (phoneIdx === -1 && headers.length === 3) phoneIdx = 2;
    let startRow = 1;
    if (headers[0]?.includes("lista") || headers[0]?.includes("perdidos")) {
      phoneIdx = 2;
      startRow = 2;
    }

    if (phoneIdx === -1) return phones;

    for (let i = startRow; i < data.length; i++) {
      const p = normalizePhone(String(data[i]?.[phoneIdx] || ""));
      if (p) phones.add(p);
    }
  } catch (e: any) {
    console.log(`  Erro ao ler ${path.basename(filePath)}: ${e.message}`);
  }
  return phones;
}

function loadCsvPhones(filePath: string, sep: string, enc: BufferEncoding): Set<string> {
  const phones = new Set<string>();
  try {
    const raw = fs.readFileSync(filePath, enc);
    const lines = raw.split("\n");
    const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
    let phoneIdx = headers.findIndex((h) =>
      h.includes("telefone") || h.includes("phone")
    );
    if (phoneIdx === -1) return phones;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep);
      const p = normalizePhone(cols[phoneIdx]);
      if (p) phones.add(p);
    }
  } catch (e: any) {
    console.log(`  Erro ao ler ${path.basename(filePath)}: ${e.message}`);
  }
  return phones;
}

function loadAllDisparoPhones(): Set<string> {
  const all = new Set<string>();
  const downloadDir = "/Users/guicrasto/Downloads";

  const xlsxFiles = [
    "Lista.xlsx",
    "lista10k.xlsx",
    "lista-10k.xlsx",
    "lista-26-01a02-02.xlsx",
    "lista_telefones_corrigida.xlsx",
    "Lista2-10k.xlsx - Planilha1_formatado.xlsx",
    "Lista3-10k.xlsx - Planilha1_formatado.xlsx",
    "Lista4-10k.xlsx - Planilha1_formatado.xlsx",
    "Lista5-  ( 12318).xlsx",
    "10k leads frio .xlsx",
    "lista 20k.xlsx",
  ];

  for (const f of xlsxFiles) {
    const phones = loadXlsxPhones(path.join(downloadDir, f));
    console.log(`  ${f}: ${phones.size.toLocaleString()} telefones`);
    for (const p of phones) all.add(p);
  }

  const csv1 = loadCsvPhones(path.join(downloadDir, "lista2-50k.csv"), ";", "latin1");
  console.log(`  lista2-50k.csv: ${csv1.size.toLocaleString()} telefones`);
  for (const p of csv1) all.add(p);

  const csv2 = loadCsvPhones(
    path.join(downloadDir, "kommo_export_leads_2026-03-27 (1).csv"), ",", "latin1"
  );
  console.log(`  kommo_export: ${csv2.size.toLocaleString()} telefones`);
  for (const p of csv2) all.add(p);

  return all;
}

// ============================
// 2. Buscar TODOS os leads + contatos do Kommo (azul)
// ============================
async function getToken() {
  const subdomain = process.env.KOMMO_SUBDOMAIN || "";
  const { data: tokenRows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("key", "kommo_azul_access_token");
  const accessToken = (tokenRows || [])[0]?.value || "";
  return { subdomain, accessToken };
}

async function fetchAllLeads(subdomain: string, accessToken: string) {
  const allLeads: any[] = [];
  for (let page = 1; page <= 1000; page++) {
    if (page % 50 === 1) console.log(`  Leads página ${page}...`);
    try {
      const res = await fetch(
        `https://${subdomain}.kommo.com/api/v4/leads?with=contacts&limit=250&page=${page}`,
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
      await new Promise((r) => setTimeout(r, 200));
    } catch (e: any) {
      console.log(`  Erro página ${page}: ${e.message}`);
      break;
    }
  }
  return allLeads;
}

// Buscar TODOS os contatos (com phone/email nos custom_fields)
async function fetchAllContacts(subdomain: string, accessToken: string) {
  const contactMap = new Map<number, { phone: string; email: string }>();
  for (let page = 1; page <= 1000; page++) {
    if (page % 50 === 1) console.log(`  Contatos página ${page}...`);
    try {
      const res = await fetch(
        `https://${subdomain}.kommo.com/api/v4/contacts?limit=250&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res.status === 204) break;
      if (!res.ok) { console.log(`  Contacts API error: ${res.status}`); break; }
      const text = await res.text();
      if (!text) break;
      const data = JSON.parse(text);
      const contacts = data?._embedded?.contacts || [];
      if (contacts.length === 0) break;

      for (const c of contacts) {
        let phone = "";
        let email = "";
        for (const cf of c.custom_fields_values || []) {
          if (cf.field_code === "PHONE") phone = cf.values?.[0]?.value?.toString() || "";
          if (cf.field_code === "EMAIL") email = cf.values?.[0]?.value?.toString() || "";
        }
        contactMap.set(c.id, { phone, email });
      }

      if (contacts.length < 250) break;
      await new Promise((r) => setTimeout(r, 200));
    } catch (e: any) {
      console.log(`  Erro contatos página ${page}: ${e.message}`);
      break;
    }
  }
  return contactMap;
}

async function fetchPipelines(subdomain: string, accessToken: string) {
  const pipelineMap = new Map<number, string>();
  const statusMap = new Map<number, string>();
  const wonStatuses = new Set<number>();
  try {
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    for (const p of data?._embedded?.pipelines || []) {
      pipelineMap.set(p.id, p.name);
      for (const s of p._embedded?.statuses || []) {
        statusMap.set(s.id, s.name);
        if (s.id === 142 || s.name?.toLowerCase().includes("ganho") || s.name?.toLowerCase().includes("won")) {
          wonStatuses.add(s.id);
        }
      }
    }
  } catch {}
  return { pipelineMap, statusMap, wonStatuses };
}

async function fetchUsers(subdomain: string, accessToken: string) {
  const map = new Map<number, string>();
  try {
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/users?limit=250`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    for (const u of data?._embedded?.users || []) map.set(u.id, u.name);
  } catch {}
  return map;
}

// ============================
// 3. Helpers
// ============================
function getContactForLead(lead: any, contactMap: Map<number, { phone: string; email: string }>) {
  const mainContact = lead._embedded?.contacts?.find((c: any) => c.is_main) || lead._embedded?.contacts?.[0];
  if (!mainContact) return { phone: "", email: "" };
  return contactMap.get(mainContact.id) || { phone: "", email: "" };
}

function extractCustomField(lead: any, fieldName: string): string {
  for (const cf of lead.custom_fields_values || []) {
    if (cf.field_name?.toLowerCase().includes(fieldName.toLowerCase())) {
      return cf.values?.[0]?.value?.toString() || "";
    }
  }
  return "";
}

function extractTags(lead: any): string {
  return (lead._embedded?.tags || []).map((t: any) => t.name).join(", ");
}

function scoreForWebinar(lead: any, contact: { phone: string; email: string }): number {
  let score = 0;

  if (contact.phone && contact.phone.length > 8) score += 3;
  if (contact.email && contact.email.includes("@")) score += 2;

  const profissao = extractCustomField(lead, "profiss");
  if (profissao) score += 2;

  const renda = extractCustomField(lead, "renda");
  if (renda) score += 2;

  const desejo = extractCustomField(lead, "desejo");
  if (desejo) score += 2;

  // Recente = melhor
  const now = Math.floor(Date.now() / 1000);
  if (lead.created_at > now - 60 * 86400) score += 1;

  // Teve interação
  if (lead.updated_at > lead.created_at + 86400) score += 1;

  // Tags de interesse
  const tags = extractTags(lead).toLowerCase();
  if (tags.includes("disparo") || tags.includes("cap") || tags.includes("inteligencia")) score += 1;

  return score;
}

function formatDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// ============================
// MAIN
// ============================
async function main() {
  console.log("=== EXTRAÇÃO 2K LEADS PARA WEBINÁRIO ===\n");

  // 1. Carregar telefones já disparados
  console.log("1. Carregando telefones das listas de disparo...");
  const disparoPhones = loadAllDisparoPhones();
  console.log(`   Total de telefones já disparados: ${disparoPhones.size.toLocaleString()}\n`);

  // 2. Buscar leads + contatos
  console.log("2. Buscando dados do Kommo (ferramentasempresa001)...");
  const token = await getToken();
  if (!token.subdomain || !token.accessToken) {
    console.error("Token não encontrado!");
    process.exit(1);
  }

  console.log("  Buscando leads, contatos, pipelines e usuários em paralelo...");
  const [allLeads, contactMap, { pipelineMap, statusMap, wonStatuses }, userMap] = await Promise.all([
    fetchAllLeads(token.subdomain, token.accessToken),
    fetchAllContacts(token.subdomain, token.accessToken),
    fetchPipelines(token.subdomain, token.accessToken),
    fetchUsers(token.subdomain, token.accessToken),
  ]);

  console.log(`   Leads: ${allLeads.length.toLocaleString()}`);
  console.log(`   Contatos: ${contactMap.size.toLocaleString()}\n`);

  // 3. Filtrar
  console.log("3. Filtrando leads...");

  let statsWon = 0, statsDisparado = 0, statsSemTel = 0, statsDeleted = 0;

  const filtered = allLeads.filter((lead) => {
    if (lead.is_deleted) { statsDeleted++; return false; }
    if (wonStatuses.has(lead.status_id)) { statsWon++; return false; }

    const contact = getContactForLead(lead, contactMap);
    const normalized = normalizePhone(contact.phone);

    if (!normalized) { statsSemTel++; return false; }
    if (disparoPhones.has(normalized)) { statsDisparado++; return false; }

    return true;
  });

  console.log(`   Excluídos — Vendas ganhas: ${statsWon}`);
  console.log(`   Excluídos — Deletados: ${statsDeleted}`);
  console.log(`   Excluídos — Sem telefone: ${statsSemTel.toLocaleString()}`);
  console.log(`   Excluídos — Já disparados: ${statsDisparado.toLocaleString()}`);
  console.log(`   ✅ Elegíveis: ${filtered.length.toLocaleString()}`);

  // 4. Scoring
  console.log("\n4. Rankeando por melhor perfil para webinário...");
  const scored = filtered.map((lead) => {
    const contact = getContactForLead(lead, contactMap);
    return { lead, contact, score: scoreForWebinar(lead, contact) };
  });

  scored.sort((a, b) => b.score - a.score);
  const top2k = scored.slice(0, 2000);

  console.log(`   Selecionados: ${top2k.length} (score ${top2k[top2k.length - 1]?.score ?? 0} a ${top2k[0]?.score ?? 0})`);

  const scoreDist = new Map<number, number>();
  for (const { score } of top2k) scoreDist.set(score, (scoreDist.get(score) || 0) + 1);
  for (const [s, count] of [...scoreDist.entries()].sort((a, b) => b[0] - a[0])) {
    console.log(`     Score ${s}: ${count} leads`);
  }

  // 5. Exportar
  console.log("\n5. Gerando CSV...");
  const headers = [
    "ID", "Nome", "Telefone", "Email", "Profissão", "Renda", "Desejo",
    "Tags", "Pipeline", "Etapa", "Responsável", "Score",
    "Criado em", "Atualizado em",
  ];

  const rows = top2k.map(({ lead, contact, score }) => [
    String(lead.id),
    lead.name || "",
    contact.phone,
    contact.email,
    extractCustomField(lead, "profiss"),
    extractCustomField(lead, "renda"),
    extractCustomField(lead, "desejo"),
    extractTags(lead),
    pipelineMap.get(lead.pipeline_id) || `#${lead.pipeline_id}`,
    statusMap.get(lead.status_id) || `#${lead.status_id}`,
    userMap.get(lead.responsible_user_id) || `#${lead.responsible_user_id}`,
    String(score),
    formatDate(lead.created_at),
    formatDate(lead.updated_at),
  ]);

  const escape = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const csvLines = [headers.map(escape).join(",")];
  for (const row of rows) csvLines.push(row.map(escape).join(","));
  const csv = "\uFEFF" + csvLines.join("\n");

  const outPath = path.resolve(__dirname, "../exports/2k-webinar-leads.csv");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, csv, "utf-8");

  console.log(`\n✅ PRONTO! ${top2k.length} leads exportados para:`);
  console.log(`   ${outPath}`);
}

main().catch(console.error);
