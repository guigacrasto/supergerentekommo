// DDD por pipeline filtrando só fechamentos (status_id=142, WON) — GAME tenant
// Janela: últimos 30 dias por closed_at

const ONLY = process.argv[2];
const STATUS_WON = 142;
const NOW = Math.floor(Date.now() / 1000);
const FROM = NOW - 30 * 86400;

const ACCOUNTS_ALL = [
  {
    team: "azul",
    subdomain: "ferramentasempresa001",
    token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6IjYyMDMyNjA4MzFmMDk0NTkxOTQyNDc5M2JiOWFiNDQ3ZDZjYWQ5NTI2ZWUzMjU5YzM0YjM2ODhkODc5NDRiZGE0YWFmODg4YTUwMDIzYTBmIn0.eyJhdWQiOiI0NGQyZDlmNi01OTQ4LTRjNTktOGQ2OC1kNWQ4N2RjMWU5YTgiLCJqdGkiOiI2MjAzMjYwODMxZjA5NDU5MTk0MjQ3OTNiYjlhYjQ0N2Q2Y2FkOTUyNmVlMzI1OWMzNGIzNjg4ZDg3OTQ0YmRhNGFhZjg4OGE1MDAyM2EwZiIsImlhdCI6MTc3NzM4MTA1NSwibmJmIjoxNzc3MzgxMDU1LCJleHAiOjE3Nzc0Njc0NTUsInN1YiI6IjEzNzk0MzE5IiwiZ3JhbnRfdHlwZSI6IiIsImFjY291bnRfaWQiOjM1MTIxNjU2LCJiYXNlX2RvbWFpbiI6ImtvbW1vLmNvbSIsInZlcnNpb24iOjIsInNjb3BlcyI6WyJwdXNoX25vdGlmaWNhdGlvbnMiLCJmaWxlcyIsImNybSIsImZpbGVzX2RlbGV0ZSIsIm5vdGlmaWNhdGlvbnMiXSwiaGFzaF91dWlkIjoiNDhjOWVlYjMtZjkxOS00NTI2LTk3M2MtMWJmYjQ5YzJlMGFmIiwiYXBpX2RvbWFpbiI6ImFwaS1jLmtvbW1vLmNvbSJ9.kmIJJh55ShDstdLriLOQpTyraYG84ilxL-c4s2FzorxR1RYUfGO9_KN8NDvulkh1cOjf12bJMRRJ3MGbN_f_PisbmOaCsL3TUJQ4RxGt0A4XuceDe7VDG5ynxzkUiai5beAT4J-4UDpX4rwKRc4Apg4bdSOg60w0cAhTu9W8Ryv3YuQhCAJ2m4x3xgsYKsFyQ3DowSLMMgSFo_Aywv3pqXZw1fWPmPJpGdu1VUQBghNiFEey0k4mHFXMHSMlPNsu4xp-cwon_18b_goJZ01ZdIenONupIN2rE4gkzNtBm-mavuRwon3hXADIO69ZyXIwyldPRaxz_dgPs8hgNneFAg",
  },
  {
    team: "amarela",
    subdomain: "iadeoperacoes",
    token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImp0aSI6ImFiNjNkZGIzOTNhZWRlOGU2YmQzMDRlNzA1MDhiZDgxZmQ4ZGE0MmJmMjBiMGQ2NjZhYjFhYTE5MmMzNDVhNDc4NWY2NzVhZTUwNjU3MzVkIn0.eyJhdWQiOiJiMzI3YjVhZS0yM2IwLTQxMGUtYWZlYi1mY2ViMmZkZThhYTYiLCJqdGkiOiJhYjYzZGRiMzkzYWVkZThlNmJkMzA0ZTcwNTA4YmQ4MWZkOGRhNDJiZjIwYjBkNjY2YWIxYWExOTJjMzQ1YTQ3ODVmNjc1YWU1MDY1NzM1ZCIsImlhdCI6MTc3MzAyNDY5OSwibmJmIjoxNzczMDI0Njk5LCJleHAiOjE4OTkxNTg0MDAsInN1YiI6IjE0NDU4MDM5IiwiZ3JhbnRfdHlwZSI6IiIsImFjY291bnRfaWQiOjM1NzcwNTQ3LCJiYXNlX2RvbWFpbiI6ImtvbW1vLmNvbSIsInZlcnNpb24iOjIsInNjb3BlcyI6WyJwdXNoX25vdGlmaWNhdGlvbnMiLCJmaWxlcyIsImNybSIsImZpbGVzX2RlbGV0ZSIsIm5vdGlmaWNhdGlvbnMiXSwiaGFzaF91dWlkIjoiMmQ2ZDA0Y2UtMzZhNy00YjUzLWExOWUtODRhYTU3ZjE4NTI1IiwiYXBpX2RvbWFpbiI6ImFwaS1nLmtvbW1vLmNvbSJ9.Dkowaywdybp-8N9ZHm3U7GnUkI0VOEJJIiLVq_OGEhg2Exru7J38grgGbcDsMTs3G26g_eku0dRejIlDTg9X41uXMWcQVD_V4J3QUBxI-9uPfVkUAVfvbs4sz-im_ZX5PJD49pjxeEnMhYfyU-bMeEQIY3ikLZ6bri-cBpsdxHtWxcTyoOaHUna2LxIkv_JsT732a-rL3KBciUDi4n0IFBUy8JdKVQQvJCeVwKbSSKoGgibmSMtlPGnw6BahbvlguQPLOqXlQDMD7BRsERU_eErd8vf6STMouZdVH7dJcCLdE1W6Im_5OGmFtCOX2Lq7TYhZvWbDsOy8YtQeT_G7bw",
  },
];

const DDD_TO_ESTADO = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF", "62": "GO", "64": "GO", "63": "TO", "65": "MT", "66": "MT", "67": "MS",
  "68": "AC", "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE", "82": "AL", "83": "PB", "84": "RN", "85": "CE", "88": "CE", "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA", "92": "AM", "97": "AM", "95": "RR", "96": "AP", "98": "MA", "99": "MA",
};

function extractDDD(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits.substring(2, 4);
  if (digits.length >= 10 && digits.length <= 11) return digits.substring(0, 2);
  return null;
}

function getPhoneFromCFs(cfs) {
  if (!Array.isArray(cfs)) return null;
  for (const cf of cfs) {
    if (cf.field_code === "PHONE" || /phone|telefone|celular/i.test(cf.field_name || "")) {
      const v = cf.values?.[0]?.value;
      if (v) return v.toString();
    }
  }
  return null;
}

async function fetchJSON(url, token, attempt = 0) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 204) return null;
    if (r.status === 429 || r.status >= 500) {
      if (attempt < 4) {
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        return fetchJSON(url, token, attempt + 1);
      }
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`${r.status} ${url}\n${t.slice(0, 500)}`);
    }
    return r.json();
  } catch (e) {
    if (attempt < 4) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      return fetchJSON(url, token, attempt + 1);
    }
    throw e;
  }
}

async function fetchAllPaginated(baseUrl, token, label) {
  const items = [];
  let page = 1;
  while (true) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}page=${page}&limit=250`;
    const data = await fetchJSON(url, token);
    if (!data || !data._embedded) break;
    const arr = data._embedded.leads || data._embedded.contacts || [];
    items.push(...arr);
    if (arr.length < 250) break;
    page++;
    if (page > 80) { console.error(`[${label}] limite atingido`); break; }
  }
  return items;
}

async function fetchContactsByIds(subdomain, token, ids) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < ids.length; i += 250) chunks.push(ids.slice(i, i + 250));
  for (const chunk of chunks) {
    const filter = chunk.map((id) => `filter[id][]=${id}`).join("&");
    const url = `https://${subdomain}.kommo.com/api/v4/contacts?${filter}&limit=250`;
    const data = await fetchJSON(url, token);
    const arr = data?._embedded?.contacts || [];
    for (const c of arr) out.set(c.id, getPhoneFromCFs(c.custom_fields_values));
  }
  return out;
}

async function processAccount(acc) {
  console.error(`\n=== ${acc.team.toUpperCase()} (${acc.subdomain}) ===`);

  const pipMap = {};
  const pipData = await fetchJSON(`https://${acc.subdomain}.kommo.com/api/v4/leads/pipelines`, acc.token);
  for (const p of pipData?._embedded?.pipelines || []) pipMap[p.id] = p.name;

  // Filtra leads WON fechados na janela
  const url = `https://${acc.subdomain}.kommo.com/api/v4/leads?with=contacts&filter[statuses][0][status_id]=${STATUS_WON}&filter[closed_at][from]=${FROM}&filter[closed_at][to]=${NOW}`;
  const leads = await fetchAllPaginated(url, acc.token, `${acc.team}-won`);
  console.error(`  ${leads.length} fechamentos (30d)`);

  const contactIds = new Set();
  for (const l of leads) {
    l._phone = getPhoneFromCFs(l.custom_fields_values);
    if (!l._phone) {
      const cs = l._embedded?.contacts || [];
      for (const c of cs) contactIds.add(c.id);
    }
  }
  console.error(`  ${contactIds.size} contatos a buscar`);

  const phoneByContact = await fetchContactsByIds(acc.subdomain, acc.token, [...contactIds]);

  for (const l of leads) {
    if (l._phone) continue;
    const cs = l._embedded?.contacts || [];
    for (const c of cs) {
      const p = phoneByContact.get(c.id);
      if (p) { l._phone = p; break; }
    }
  }

  const grouped = {};
  const valueByPipDDD = {};
  for (const l of leads) {
    const pipName = pipMap[l.pipeline_id] || `Pipeline ${l.pipeline_id}`;
    const ddd = extractDDD(l._phone) || "?";
    const key = `${acc.team}::${pipName}`;
    if (!grouped[key]) grouped[key] = {};
    grouped[key][ddd] = (grouped[key][ddd] || 0) + 1;
    if (!valueByPipDDD[key]) valueByPipDDD[key] = {};
    valueByPipDDD[key][ddd] = (valueByPipDDD[key][ddd] || 0) + (l.price || 0);
  }
  return { grouped, valueByPipDDD };
}

const ACCOUNTS = ONLY ? ACCOUNTS_ALL.filter((a) => a.team === ONLY) : ACCOUNTS_ALL;

(async () => {
  const all = {};
  const allValue = {};
  for (const acc of ACCOUNTS) {
    try {
      const { grouped, valueByPipDDD } = await processAccount(acc);
      Object.assign(all, grouped);
      Object.assign(allValue, valueByPipDDD);
    } catch (e) {
      console.error(`ERRO ${acc.team}: ${e.message}`);
    }
  }

  console.log("\n# Fechamentos por DDD/pipeline — GAME (últimos 30 dias)\n");
  const sortedKeys = Object.keys(all).sort();
  let csv = "conta,pipeline,ddd,uf,fechamentos,pct,valor_total\n";
  let grandTotalLeads = 0;
  let grandTotalValue = 0;
  const dddTotal = {};

  for (const key of sortedKeys) {
    const ddds = all[key];
    const total = Object.values(ddds).reduce((a, b) => a + b, 0);
    const totalValue = Object.values(allValue[key] || {}).reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    grandTotalLeads += total;
    grandTotalValue += totalValue;
    console.log(`\n## ${key}  (fechamentos: ${total} · R$ ${totalValue.toLocaleString('pt-BR')})`);
    const rows = Object.entries(ddds)
      .sort((a, b) => b[1] - a[1])
      .map(([d, n]) => ({
        ddd: d,
        estado: DDD_TO_ESTADO[d] || "",
        fechamentos: n,
        pct: ((n / total) * 100).toFixed(1) + "%",
        valor: (allValue[key] && allValue[key][d]) || 0,
      }));
    console.log("DDD | UF  | Fechs | %      | R$");
    console.log("----|-----|-------|--------|----------");
    for (const r of rows.slice(0, 15)) {
      console.log(`${r.ddd.padEnd(3)} | ${r.estado.padEnd(3)} | ${String(r.fechamentos).padStart(5)} | ${r.pct.padStart(6)} | ${r.valor.toLocaleString('pt-BR')}`);
      const [conta, pipeline] = key.split("::");
      csv += `${conta},${pipeline},${r.ddd},${r.estado},${r.fechamentos},${r.pct},${r.valor}\n`;
      dddTotal[r.ddd] = (dddTotal[r.ddd] || 0) + r.fechamentos;
    }
    if (rows.length > 15) console.log(`... +${rows.length - 15} outros`);
  }

  console.log(`\n## TOTAL CONSOLIDADO GAME — Fechamentos: ${grandTotalLeads} · R$ ${grandTotalValue.toLocaleString('pt-BR')}`);
  const ranked = Object.entries(dddTotal).sort((a, b) => b[1] - a[1]);
  console.log("\nDDD | UF  | Fechs | % do total");
  console.log("----|-----|-------|----------");
  for (const [ddd, n] of ranked.slice(0, 20)) {
    console.log(`${ddd.padEnd(3)} | ${(DDD_TO_ESTADO[ddd] || "").padEnd(3)} | ${String(n).padStart(5)} | ${((n / grandTotalLeads) * 100).toFixed(1) + '%'}`);
  }

  await import('fs').then(fs => fs.writeFileSync('/Users/guicrasto/supergerente/exports/ddd-fechamentos-pipeline-30d.csv', csv));
  console.log('\n📁 CSV: exports/ddd-fechamentos-pipeline-30d.csv');
})();
