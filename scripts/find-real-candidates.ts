/**
 * Busca leads que REALMENTE se enquadram nas regras de remanejamento
 * Lista candidatos sem executar nada
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

async function main() {
  console.log("🔍 BUSCANDO LEADS QUE SE ENQUADRAM NAS REGRAS REAIS");
  console.log(`   Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  console.log(`   Limite: 1 lead por regra/funil (pra testar)\n`);

  const now = Math.floor(Date.now() / 1000);

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

        // Buscar um lote pequeno de leads (50) pra nao sobrecarregar
        let leads: any[] = [];
        try {
          const res = await service.client.get("/leads", {
            params: {
              limit: 50,
              with: "custom_fields_values,contacts,source_id",
              filter: {
                statuses: [{ pipeline_id: pipeline.id, status_id: targetStatus.id }],
              },
              order: { updated_at: "asc" }, // mais antigos primeiro
            },
          });
          leads = res.data?._embedded?.leads || [];
        } catch {
          continue;
        }

        // Filtrar pelo criterio real
        let found = false;
        for (const lead of leads) {
          const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;
          const daysInStage = Math.floor((now - statusChangedAt) / 86400);

          if (daysInStage < rule.days) continue;

          // R1: verificar notas
          if (rule.requiresNoNotes) {
            const notes = await service.getLeadNotes(lead.id);
            if (notes.length > 0) continue;
          }

          // Encontrou! Mostrar detalhes
          const phone = extractPhone(lead);
          console.log(`\n📌 ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel}`);
          console.log(`   Etapa: "${targetStatus.name}"`);
          console.log(`   Lead ID: ${lead.id}`);
          console.log(`   Nome: ${lead.name || "(sem nome)"}`);
          console.log(`   Telefone: ${phone || "(sem telefone)"}`);
          console.log(`   Responsavel ID: ${lead.responsible_user_id}`);
          console.log(`   Dias na etapa: ${daysInStage}`);
          if (rule.requiresNoNotes) {
            console.log(`   Notas: 0 (sem nota)`);
          }
          console.log(`   Destino: NEW LEADS 2 (status_id: ${newLeads2.id})`);
          found = true;
          break; // so 1 por regra/funil
        }

        if (!found) {
          console.log(`\n⚪ ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel} — nenhum candidato encontrado nos primeiros 50 leads`);
        }
      }
    }
  }

  console.log(`\n\n${"=".repeat(70)}`);
  console.log("Acima estao os leads que SE ENQUADRAM nas regras reais.");
  console.log("Nenhum lead foi movido. Confira e me diga quais testar.");
  console.log("=".repeat(70));
}

function extractPhone(lead: any): string {
  for (const c of lead._embedded?.contacts || []) {
    for (const cf of c.custom_fields_values || []) {
      if (cf.field_code === "PHONE") return cf.values?.[0]?.value?.toString() || "";
    }
  }
  // Tentar nos custom fields do lead
  for (const cf of lead.custom_fields_values || []) {
    if (cf.field_code === "PHONE" || cf.field_name?.toLowerCase().includes("telefone") || cf.field_name?.toLowerCase().includes("phone")) {
      return cf.values?.[0]?.value?.toString() || "";
    }
  }
  return "";
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
