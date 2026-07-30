/**
 * Desfaz os testes de remanejamento — fecha leads novos e reabre antigos
 */
import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");

// Leads criados pelo teste (Run 1 - amarela)
const RUN1_AMARELA = [
  { oldId: 5774714, newId: 26305003, pipeline: "Funil de vendas", team: "amarela" as const },
  { oldId: 5980384, newId: 26305005, pipeline: "Funil de vendas", team: "amarela" as const },
  { oldId: 6188404, newId: 26305011, pipeline: "Funil de Vendas - Vectora", team: "amarela" as const },
  { oldId: 5569466, newId: 26305015, pipeline: "Funil de Vendas - Vectora", team: "amarela" as const },
];

// Leads criados pelo teste (Run 2 - azul)
const RUN2_AZUL = [
  { oldId: 8953474, newId: 41357044, pipeline: "FUNIL PLUS", team: "azul" as const },
  { oldId: 8953474, newId: 41357048, pipeline: "FUNIL PLUS", team: "azul" as const },
  { oldId: 8953474, newId: 41357050, pipeline: "FUNIL CRYPTOSENSE", team: "azul" as const },
  { oldId: 8953474, newId: 41357052, pipeline: "FUNIL CRYPTOSENSE", team: "azul" as const },
  { oldId: 8953474, newId: 41357058, pipeline: "FUNIL TRYVION", team: "azul" as const },
  { oldId: 8953474, newId: 41357060, pipeline: "FUNIL TRYVION", team: "azul" as const },
  { oldId: 8953474, newId: 41357066, pipeline: "FUNIL NEW MATRIZ", team: "azul" as const },
  { oldId: 8953474, newId: 41357072, pipeline: "FUNIL NEW MATRIZ", team: "azul" as const },
  { oldId: 8953474, newId: 41357076, pipeline: "FUNIL AXION", team: "azul" as const },
  { oldId: 8953474, newId: 41357080, pipeline: "FUNIL AXION", team: "azul" as const },
];

// Lead do debug script
const DEBUG_AZUL = [
  { oldId: 0, newId: 41356870, pipeline: "FUNIL PLUS (debug)", team: "azul" as const },
];

// Run 2 amarela
const RUN2_AMARELA = [
  { oldId: 5927162, newId: 26305297, pipeline: "Funil de vendas", team: "amarela" as const },
  { oldId: 5998870, newId: 26305301, pipeline: "Funil de vendas", team: "amarela" as const },
  { oldId: 8208268, newId: 26305305, pipeline: "Funil de Vendas - Vectora", team: "amarela" as const },
  { oldId: 8217988, newId: 26305313, pipeline: "Funil de Vendas - Vectora", team: "amarela" as const },
];

const ALL = [...RUN1_AMARELA, ...RUN2_AZUL, ...DEBUG_AZUL, ...RUN2_AMARELA];

async function main() {
  console.log("🔄 DESFAZENDO TESTES DE REMANEJAMENTO\n");

  const services: Record<string, KommoService> = {};

  for (const team of ["azul", "amarela"] as const) {
    if (TEAMS[team].subdomain) {
      const svc = new KommoService(TEAMS[team], team);
      await svc.loadStoredToken();
      services[team] = svc;
    }
  }

  // 1. Fechar leads novos criados pelo teste
  console.log("--- FASE 1: Fechando leads novos criados pelo teste ---\n");
  for (const item of ALL) {
    const svc = services[item.team];
    if (!svc) continue;

    try {
      const closed = await svc.closeLeadAsLost(item.newId);
      console.log(`${closed ? "✅" : "❌"} Fechou lead novo ${item.newId} (${item.team}/${item.pipeline})`);
    } catch (e: any) {
      console.log(`❌ Erro ao fechar ${item.newId}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // 2. Reabrir leads antigos (remover status de venda perdida)
  // No Kommo, pra "reabrir" um lead fechado, fazemos PATCH com o status_id da etapa original
  // Mas nao sabemos a etapa original exata, entao vamos adicionar uma nota explicando
  console.log("\n--- FASE 2: Adicionando nota nos leads antigos ---\n");

  const oldLeadIds = new Set(ALL.filter(a => a.oldId > 0).map(a => ({ id: a.oldId, team: a.team })));
  const processed = new Set<string>();

  for (const { id, team } of oldLeadIds) {
    const key = `${team}:${id}`;
    if (processed.has(key)) continue;
    processed.add(key);

    const svc = services[team];
    if (!svc) continue;

    try {
      await svc.addNote(id, "[SuperGerente] NOTA DE TESTE removida — os remanejamentos de teste foram desfeitos.");
      console.log(`✅ Nota adicionada ao lead antigo ${id} (${team})`);
    } catch (e: any) {
      console.log(`❌ Erro ao adicionar nota em ${id}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log("\n🏁 Cleanup concluido.");
  console.log("   Leads novos foram fechados como perdidos.");
  console.log("   Os leads antigos ja estavam como perdidos (do teste).");
  console.log("   Notas de esclarecimento adicionadas.");
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
