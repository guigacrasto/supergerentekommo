/**
 * Busca leads REAIS nas etapas corretas — SEM filtro de dias
 * Apenas lista para conferencia, nao move nada
 */
import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");
type TeamKey = "azul" | "amarela";

const STAGE_RULES: Record<TeamKey, Array<{ stageName: string; days: number; requiresNoNotes: boolean; ruleLabel: string }>> = {
  azul: [
    { stageName: "EM ATENDIMENTO", days: 10, requiresNoNotes: true, ruleLabel: "R1 (10d sem nota)" },
    { stageName: "N ATENDEU/ CX POSTAL /SEM RESPOSTA", days: 15, requiresNoNotes: false, ruleLabel: "R2 (15d)" },
  ],
  amarela: [
    { stageName: "CLIENTE INTERESSADO", days: 10, requiresNoNotes: true, ruleLabel: "R1 (10d sem nota)" },
    { stageName: "n atendeu / cx postal / SEM RESPOSTA", days: 15, requiresNoNotes: false, ruleLabel: "R2 (15d)" },
  ],
};

function extractPhone(lead: any): string {
  for (const c of lead._embedded?.contacts || []) {
    for (const cf of c.custom_fields_values || []) {
      if (cf.field_code === "PHONE") return cf.values?.[0]?.value?.toString() || "";
    }
  }
  for (const cf of lead.custom_fields_values || []) {
    if (cf.field_code === "PHONE" || cf.field_name?.toLowerCase().includes("telefone")) {
      return cf.values?.[0]?.value?.toString() || "";
    }
  }
  return "";
}

async function main() {
  console.log("🔍 BUSCANDO LEADS REAIS — SEM FILTRO DE DIAS (TESTE)");
  console.log(`   Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  console.log(`   Mostrando 1 lead por regra/funil que REALMENTE esta na etapa\n`);

  const now = Math.floor(Date.now() / 1000);
  let totalFound = 0;

  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) continue;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`CONTA: ${team.toUpperCase()}`);
    console.log("=".repeat(70));

    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    const pipelines = await service.getPipelines();
    const rules = STAGE_RULES[team];

    for (const pipeline of pipelines) {
      const statuses: Array<{ id: number; name: string }> = pipeline._embedded?.statuses || [];
      const newLeads2 = statuses.find(s => s.name.toUpperCase().includes("NEW LEADS 2"));
      if (!newLeads2) continue;

      for (const rule of rules) {
        const targetStatus = statuses.find(
          s => s.name.trim().toUpperCase() === rule.stageName.trim().toUpperCase()
        );
        if (!targetStatus) continue;

        // Buscar leads nessa etapa — paginar ate achar 1 REAL
        let page = 1;
        let found = false;

        while (page <= 5 && !found) {
          let leads: any[] = [];
          try {
            const res = await service.client.get("/leads", {
              params: {
                limit: 50,
                page,
                with: "custom_fields_values,contacts,source_id",
                filter: {
                  statuses: [{ pipeline_id: pipeline.id, status_id: targetStatus.id }],
                },
              },
            });
            leads = res.data?._embedded?.leads || [];
          } catch {
            break;
          }

          if (leads.length === 0) break;

          for (const lead of leads) {
            // VERIFICACAO CRITICA: pipeline_id e status_id reais
            if (lead.pipeline_id !== pipeline.id) continue;
            if (lead.status_id !== targetStatus.id) continue;

            // SEM filtro de dias — mostramos qualquer lead na etapa
            const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;
            const daysInStage = Math.floor((now - statusChangedAt) / 86400);

            // R1: verificar notas (manter esse filtro pra ser fiel a regra)
            let noteCount = 0;
            if (rule.requiresNoNotes) {
              const notes = await service.getLeadNotes(lead.id);
              noteCount = notes.length;
              if (notes.length > 0) continue; // R1 exige 0 notas
            }

            const phone = extractPhone(lead);
            totalFound++;
            console.log(`\n📌 #${totalFound} | ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel}`);
            console.log(`   Etapa: "${targetStatus.name}" (status_id: ${targetStatus.id})`);
            console.log(`   Lead ID: ${lead.id}`);
            console.log(`   Nome: ${lead.name || "(sem nome)"}`);
            console.log(`   Telefone: ${phone || "(sem telefone)"}`);
            console.log(`   Pipeline ID (real): ${lead.pipeline_id} ✅ (confere com ${pipeline.id})`);
            console.log(`   Status ID (real): ${lead.status_id} ✅ (confere com ${targetStatus.id})`);
            console.log(`   Responsavel ID: ${lead.responsible_user_id}`);
            console.log(`   Dias na etapa: ${daysInStage}`);
            if (rule.requiresNoNotes) console.log(`   Notas: ${noteCount} (sem nota ✅)`);
            console.log(`   Destino: NEW LEADS 2 (status_id: ${newLeads2.id})`);
            console.log(`   ⚠️  Em producao, so seria movido com ${rule.days}+ dias`);
            found = true;
            break;
          }

          page++;
        }

        if (!found) {
          console.log(`\n⚪ ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel} — nenhum lead real encontrado`);
        }
      }
    }
  }

  console.log(`\n\n${"=".repeat(70)}`);
  console.log(`TOTAL: ${totalFound} leads reais encontrados`);
  console.log("Nenhum foi movido. Confira e me diga quais testar.");
  console.log("=".repeat(70));
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
