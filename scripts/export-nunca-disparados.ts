/**
 * Exporta TODOS os leads do Kommo (azul) que nunca receberam disparo.
 * Rodar: npx tsx scripts/export-nunca-disparados.ts
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
    let phoneIdx = headers.findIndex((h: string) => h.includes("telefone") || h.includes("phone") || h.includes("celular"));
    if (phoneIdx === -1 && headers.length === 3) phoneIdx = 2;
    let startRow = 1;
    if (headers[0]?.includes("lista") || headers[0]?.includes("perdidos")) { phoneIdx = 2; startRow = 2; }
    if (phoneIdx === -1) return phones;
    for (let i = startRow; i < data.length; i++) {
      const p = normalizePhone(String(data[i]?.[phoneIdx] || ""));
      if (p) phones.add(p);
    }
  } catch {}
  return phones;
}

function loadCsvPhones(filePath: string, sep: string, enc: BufferEncoding): Set<string> {
  const phones = new Set<string>();
  try {
    const raw = fs.readFileSync(filePath, enc);
    const lines = raw.split("\n");
    const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
    let phoneIdx = headers.findIndex((h) => h.includes("telefone") || h.includes("phone"));
    if (phoneIdx === -1) return phones;
    for (let i = 1; i < lines.length; i++) {
      const p = normalizePhone(lines[i].split(sep)[phoneIdx]);
      if (p) phones.add(p);
    }
  } catch {}
  return phones;
}

async function main() {
  console.log("=== EXPORT: TODOS OS NUNCA DISPARADOS ===\n");

  // 1. Telefones já disparados
  console.log("1. Carregando listas de disparo...");
  const disparoPhones = new Set<string>();
  const dl = "/Users/guicrasto/Downloads";
  const xlsxFiles = [
    "Lista.xlsx", "lista10k.xlsx", "lista-10k.xlsx", "lista-26-01a02-02.xlsx",
    "lista_telefones_corrigida.xlsx", "Lista2-10k.xlsx - Planilha1_formatado.xlsx",
    "Lista3-10k.xlsx - Planilha1_formatado.xlsx", "Lista4-10k.xlsx - Planilha1_formatado.xlsx",
    "Lista5-  ( 12318).xlsx", "10k leads frio .xlsx", "lista 20k.xlsx",
  ];
  for (const f of xlsxFiles) for (const p of loadXlsxPhones(path.join(dl, f))) disparoPhones.add(p);
  for (const p of loadCsvPhones(path.join(dl, "lista2-50k.csv"), ";", "latin1")) disparoPhones.add(p);
  for (const p of loadCsvPhones(path.join(dl, "kommo_export_leads_2026-03-27 (1).csv"), ",", "latin1")) disparoPhones.add(p);
  console.log(`   ${disparoPhones.size.toLocaleString()} telefones disparados\n`);

  // 2. Token
  const subdomain = process.env.KOMMO_SUBDOMAIN || "";
  const { data: tokenRows } = await supabase.from("settings").select("key, value").eq("key", "kommo_azul_access_token");
  const accessToken = (tokenRows || [])[0]?.value || "";

  // 3. Leads
  console.log("2. Buscando leads...");
  const allLeads: any[] = [];
  for (let page = 1; page <= 1000; page++) {
    if (page % 100 === 1) console.log(`   Página ${page}...`);
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads?with=contacts&limit=250&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 204) break;
    if (!res.ok) break;
    const text = await res.text();
    if (!text) break;
    const leads = JSON.parse(text)?._embedded?.leads || [];
    if (!leads.length) break;
    allLeads.push(...leads);
    if (leads.length < 250) break;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`   ${allLeads.length.toLocaleString()} leads\n`);

  // 4. Contatos
  console.log("3. Buscando contatos...");
  const contactMap = new Map<number, { phone: string; email: string }>();
  for (let page = 1; page <= 1000; page++) {
    if (page % 100 === 1) console.log(`   Página ${page}...`);
    const res = await fetch(`https://${subdomain}.kommo.com/api/v4/contacts?limit=250&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 204) break;
    if (!res.ok) break;
    const text = await res.text();
    if (!text) break;
    const contacts = JSON.parse(text)?._embedded?.contacts || [];
    if (!contacts.length) break;
    for (const c of contacts) {
      let phone = "", email = "";
      for (const cf of c.custom_fields_values || []) {
        if (cf.field_code === "PHONE") phone = cf.values?.[0]?.value?.toString() || "";
        if (cf.field_code === "EMAIL") email = cf.values?.[0]?.value?.toString() || "";
      }
      contactMap.set(c.id, { phone, email });
    }
    if (contacts.length < 250) break;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`   ${contactMap.size.toLocaleString()} contatos\n`);

  // 5. Pipelines/Statuses/Users
  const pipelineMap = new Map<number, string>();
  const statusMap = new Map<number, string>();
  const wonStatuses = new Set<number>();
  const pRes = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, { headers: { Authorization: `Bearer ${accessToken}` } });
  for (const p of (await pRes.json())?._embedded?.pipelines || []) {
    pipelineMap.set(p.id, p.name);
    for (const s of p._embedded?.statuses || []) {
      statusMap.set(s.id, s.name);
      if (s.id === 142 || s.name?.toLowerCase().includes("ganho") || s.name?.toLowerCase().includes("won")) wonStatuses.add(s.id);
    }
  }
  const userMap = new Map<number, string>();
  const uRes = await fetch(`https://${subdomain}.kommo.com/api/v4/users?limit=250`, { headers: { Authorization: `Bearer ${accessToken}` } });
  for (const u of (await uRes.json())?._embedded?.users || []) userMap.set(u.id, u.name);

  // 6. Filtrar
  console.log("4. Filtrando nunca disparados...");
  function getContact(lead: any) {
    const mc = lead._embedded?.contacts?.find((c: any) => c.is_main) || lead._embedded?.contacts?.[0];
    return mc ? (contactMap.get(mc.id) || { phone: "", email: "" }) : { phone: "", email: "" };
  }

  const nuncaDisparados = allLeads.filter(lead => {
    if (lead.is_deleted || wonStatuses.has(lead.status_id)) return false;
    const contact = getContact(lead);
    const norm = normalizePhone(contact.phone);
    if (!norm) return false;
    return !disparoPhones.has(norm);
  });
  console.log(`   ✅ ${nuncaDisparados.length.toLocaleString()} leads nunca disparados\n`);

  // 7. Exportar CSV
  console.log("5. Exportando CSV...");
  function extractCF(lead: any, name: string): string {
    for (const cf of lead.custom_fields_values || []) {
      if (cf.field_name?.toLowerCase().includes(name.toLowerCase())) return cf.values?.[0]?.value?.toString() || "";
    }
    return "";
  }
  function tags(lead: any): string { return (lead._embedded?.tags || []).map((t: any) => t.name).join(", "); }
  function fmtDate(ts: number): string {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }
  const esc = (v: string) => (v.includes(",") || v.includes('"') || v.includes("\n")) ? `"${v.replace(/"/g, '""')}"` : v;

  const hdrs = ["ID","Nome","Telefone","Email","Profissão","Renda","Desejo","Tags","Pipeline","Etapa","Responsável","Criado em","Atualizado em"];
  const rows = nuncaDisparados.map(lead => {
    const ct = getContact(lead);
    return [
      String(lead.id), lead.name || "", ct.phone, ct.email,
      extractCF(lead, "profiss"), extractCF(lead, "renda"), extractCF(lead, "desejo"),
      tags(lead), pipelineMap.get(lead.pipeline_id) || "", statusMap.get(lead.status_id) || "",
      userMap.get(lead.responsible_user_id) || "", fmtDate(lead.created_at), fmtDate(lead.updated_at),
    ];
  });

  const csv = "\uFEFF" + [hdrs.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
  const outDir = path.resolve(__dirname, "../exports");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "todos-nunca-disparados.csv"), csv, "utf-8");

  console.log(`✅ ${nuncaDisparados.length.toLocaleString()} leads exportados para exports/todos-nunca-disparados.csv`);
}

main().catch(console.error);
