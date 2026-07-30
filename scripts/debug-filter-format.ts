/**
 * Debug: testa formatos de serialização do filtro de status
 */
import dotenv from "dotenv";
dotenv.config();
import qs from "qs";

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");

async function main() {
  console.log("🔍 DEBUG — TESTANDO FORMATO DE FILTRO\n");

  const service = new KommoService(TEAMS.azul, "azul");
  await service.loadStoredToken();

  const pipelines = await service.getPipelines();
  const pipeline = pipelines.find((p: any) => p.name === "FUNIL PLUS");
  if (!pipeline) { console.log("Pipeline FUNIL PLUS não encontrado"); return; }

  const statuses = pipeline._embedded?.statuses || [];
  const emAtendimento = statuses.find((s: any) => s.name === "EM ATENDIMENTO");
  if (!emAtendimento) { console.log("Etapa EM ATENDIMENTO não encontrada"); return; }

  console.log(`Pipeline: ${pipeline.name} (${pipeline.id})`);
  console.log(`Etapa: ${emAtendimento.name} (${emAtendimento.id})`);

  // Teste 1: format brackets (atual)
  const paramsBrackets = qs.stringify({
    limit: 3,
    filter: { statuses: [{ pipeline_id: pipeline.id, status_id: emAtendimento.id }] },
  }, { arrayFormat: "brackets" });
  console.log(`\n--- BRACKETS: ${paramsBrackets}`);

  // Teste 2: format indices
  const paramsIndices = qs.stringify({
    limit: 3,
    filter: { statuses: [{ pipeline_id: pipeline.id, status_id: emAtendimento.id }] },
  }, { arrayFormat: "indices" });
  console.log(`--- INDICES: ${paramsIndices}`);

  // Teste 3: chamada manual com indices
  console.log("\n📡 Chamando API com formato INDICES...");
  try {
    const res = await service.client.get(`/leads?${paramsIndices}&with=contacts`);
    const leads = res.data?._embedded?.leads || [];
    console.log(`API retornou ${leads.length} leads:`);
    for (const lead of leads) {
      console.log(`  Lead ${lead.id} "${lead.name}" — pipeline_id: ${lead.pipeline_id} ${lead.pipeline_id === pipeline.id ? "✅" : "❌"} — status_id: ${lead.status_id} ${lead.status_id === emAtendimento.id ? "✅" : "❌"}`);
    }
  } catch (e: any) {
    console.log(`❌ Erro: ${e.message}`);
  }
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
