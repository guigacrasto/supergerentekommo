/**
 * Debug: mostra leads retornados pela API e seus pipeline_ids reais
 */
import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");
type TeamKey = "azul" | "amarela";

const STAGE_NAMES: Record<TeamKey, string[]> = {
  azul: ["EM ATENDIMENTO", "N ATENDEU/ CX POSTAL /SEM RESPOSTA"],
  amarela: ["CLIENTE INTERESSADO", "n atendeu / cx postal / SEM RESPOSTA"],
};

async function main() {
  console.log("🔍 DEBUG — VERIFICANDO LEADS RETORNADOS PELA API\n");

  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) continue;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`CONTA: ${team.toUpperCase()}`);
    console.log("=".repeat(70));

    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    const pipelines = await service.getPipelines();

    for (const pipeline of pipelines) {
      const statuses: Array<{ id: number; name: string }> = pipeline._embedded?.statuses || [];
      const hasNewLeads2 = statuses.some(s => s.name.toUpperCase().includes("NEW LEADS 2"));
      if (!hasNewLeads2) continue;

      console.log(`\n--- Pipeline: "${pipeline.name}" (id: ${pipeline.id}) ---`);
      console.log(`    Etapas: ${statuses.map(s => `"${s.name}" (${s.id})`).join(", ")}`);

      for (const stageName of STAGE_NAMES[team]) {
        const targetStatus = statuses.find(
          s => s.name.trim().toUpperCase() === stageName.trim().toUpperCase()
        );

        if (!targetStatus) {
          console.log(`    ❌ Etapa "${stageName}" NAO EXISTE neste funil`);
          continue;
        }

        console.log(`\n    🔎 Buscando leads em "${targetStatus.name}" (status_id: ${targetStatus.id})...`);

        try {
          const res = await service.client.get("/leads", {
            params: {
              limit: 5,
              with: "contacts",
              filter: {
                statuses: [{ pipeline_id: pipeline.id, status_id: targetStatus.id }],
              },
            },
          });
          const leads = res.data?._embedded?.leads || [];
          console.log(`    📊 API retornou ${leads.length} leads`);

          for (const lead of leads.slice(0, 3)) {
            const match = lead.pipeline_id === pipeline.id;
            console.log(`       Lead ${lead.id} "${lead.name}" — pipeline_id: ${lead.pipeline_id} ${match ? "✅" : `❌ (esperado ${pipeline.id})`} — status_id: ${lead.status_id} ${lead.status_id === targetStatus.id ? "✅" : "❌"}`);
          }
        } catch (e: any) {
          console.log(`    ❌ Erro: ${e.message}`);
        }
      }
    }
  }
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
