/**
 * Teste REAL documentado de remanejamento
 * Captura estado antes/depois de cada lead pra documentação
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

interface DocResult {
  num: number;
  team: string;
  pipeline: string;
  pipelineId: number;
  rule: string;
  stageName: string;
  stageId: number;
  newLeads2Id: number;
  // Before
  oldLeadId: number;
  oldLeadName: string;
  oldResponsibleId: number;
  daysInStage: number;
  noteCount: number;
  // After
  newLeadId: number;
  oldLeadClosed: boolean;
  noteAdded: boolean;
  status: "OK" | "ERRO";
  error?: string;
}

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
  console.log("🧪 TESTE REAL DOCUMENTADO DE REMANEJAMENTO");
  console.log(`   Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  console.log(`   Objetivo: Remanejar 1 lead por regra/funil e documentar antes/depois\n`);

  const now = Math.floor(Date.now() / 1000);
  const results: DocResult[] = [];
  let num = 0;

  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) continue;

    console.log(`\n${"=".repeat(70)}`);
    console.log(`CONTA: ${team.toUpperCase()}`);
    console.log("=".repeat(70));

    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    // Loss reason
    const reasons = await service.getLossReasons();
    const lossReason = reasons.find((r: any) =>
      r.name.toLowerCase().includes("não satisfeito") ||
      r.name.toLowerCase().includes("nao satisfeito")
    );
    console.log(`Loss reason: ${lossReason ? `"${lossReason.name}" (${lossReason.id})` : "NAO ENCONTRADO"}`);

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

        // Buscar 1 lead real
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
          } catch { break; }

          if (leads.length === 0) break;

          for (const lead of leads) {
            if (lead.pipeline_id !== pipeline.id) continue;
            if (lead.status_id !== targetStatus.id) continue;

            // R1: verificar notas
            let noteCount = 0;
            if (rule.requiresNoNotes) {
              const notes = await service.getLeadNotes(lead.id);
              noteCount = notes.length;
              if (notes.length > 0) continue;
            }

            num++;
            const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;
            const daysInStage = Math.floor((now - statusChangedAt) / 86400);
            const phone = extractPhone(lead);

            // ===== ANTES =====
            console.log(`\n${"─".repeat(70)}`);
            console.log(`📌 #${num} | ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel}`);
            console.log(`${"─".repeat(70)}`);
            console.log(`\n  📋 ANTES:`);
            console.log(`     Lead ID: ${lead.id}`);
            console.log(`     Nome: ${lead.name || "(sem nome)"}`);
            console.log(`     Telefone: ${phone || "(sem telefone)"}`);
            console.log(`     Pipeline: ${pipeline.name} (id: ${pipeline.id})`);
            console.log(`     Etapa ATUAL: "${targetStatus.name}" (status_id: ${targetStatus.id})`);
            console.log(`     Responsavel ID: ${lead.responsible_user_id}`);
            console.log(`     Dias na etapa: ${daysInStage}`);
            console.log(`     Notas: ${noteCount}`);
            console.log(`     Status: ATIVO`);

            // ===== EXECUTAR REMANEJAMENTO =====
            const result: DocResult = {
              num, team, pipeline: pipeline.name, pipelineId: pipeline.id,
              rule: rule.ruleLabel, stageName: targetStatus.name, stageId: targetStatus.id,
              newLeads2Id: newLeads2.id,
              oldLeadId: lead.id, oldLeadName: lead.name || "(sem nome)",
              oldResponsibleId: lead.responsible_user_id, daysInStage, noteCount,
              newLeadId: 0, oldLeadClosed: false, noteAdded: false, status: "OK",
            };

            try {
              // 1. Criar novo lead em NEW LEADS 2
              const newLeadData: any = {
                name: lead.name || "Lead Remanejado",
                pipeline_id: pipeline.id,
                status_id: newLeads2.id,
                responsible_user_id: lead.responsible_user_id,
              };
              if (lead.price) newLeadData.price = lead.price;
              if (lead._embedded?.tags?.length > 0) {
                newLeadData._embedded = { tags: lead._embedded.tags.map((t: any) => ({ name: t.name })) };
              }

              let newLead: any;
              if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                newLeadData.custom_fields_values = lead.custom_fields_values;
                try {
                  newLead = await service.createLead(newLeadData);
                } catch (cfErr: any) {
                  if (cfErr?.response?.status === 400) {
                    console.log(`     ⚠️  Custom fields causaram erro 400, tentando sem eles...`);
                    delete newLeadData.custom_fields_values;
                    newLead = await service.createLead(newLeadData);
                  } else { throw cfErr; }
                }
              } else {
                newLead = await service.createLead(newLeadData);
              }
              result.newLeadId = newLead?.id || 0;

              // 2. Nota no lead antigo
              await service.addNote(
                lead.id,
                `[SuperGerente] Lead remanejado automaticamente — ${rule.ruleLabel} — ${daysInStage} dias na etapa "${targetStatus.name}" — Novo lead ID: ${newLead?.id || "?"}`
              );
              result.noteAdded = true;

              // 3. Fechar lead antigo como perdido
              const closed = await service.closeLeadAsLost(lead.id, lossReason?.id);
              result.oldLeadClosed = closed;

              // ===== DEPOIS =====
              console.log(`\n  ✅ DEPOIS:`);
              console.log(`     Lead ANTIGO ${lead.id}:`);
              console.log(`       → Status: VENDA PERDIDA (fechado)`);
              console.log(`       → Motivo: "${lossReason?.name || "sem motivo"}"`);
              console.log(`       → Nota adicionada: SIM`);
              console.log(`     Lead NOVO ${newLead?.id}:`);
              console.log(`       → Pipeline: ${pipeline.name} (id: ${pipeline.id})`);
              console.log(`       → Etapa: NEW LEADS 2 (status_id: ${newLeads2.id})`);
              console.log(`       → Responsavel: ${lead.responsible_user_id} (mesmo)`);
              console.log(`       → Nome: ${lead.name || "Lead Remanejado"}`);

            } catch (err: any) {
              result.status = "ERRO";
              result.error = err.message;
              console.log(`\n  ❌ ERRO: ${err.message}`);
            }

            results.push(result);
            found = true;

            // Delay entre operações
            await new Promise(r => setTimeout(r, 1000));
            break;
          }

          page++;
        }

        if (!found) {
          console.log(`\n⚪ ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel} — nenhum lead encontrado`);
        }
      }
    }
  }

  // ===== RESUMO FINAL =====
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("📊 RESUMO — MAPEAMENTO ANTES/DEPOIS");
  console.log("=".repeat(70));

  const ok = results.filter(r => r.status === "OK");
  const err = results.filter(r => r.status === "ERRO");
  console.log(`\n✅ ${ok.length} remanejamentos OK | ❌ ${err.length} com erro\n`);

  console.log("┌─────┬────────────┬──────────────────────┬────────────────────────────────┬────────────┬──────────────┬─────────────┐");
  console.log("│  #  │  Conta     │  Funil               │  Lead Antigo                   │  Dias      │  Regra       │  Lead Novo  │");
  console.log("├─────┼────────────┼──────────────────────┼────────────────────────────────┼────────────┼──────────────┼─────────────┤");

  for (const r of results) {
    const icon = r.status === "OK" ? "✅" : "❌";
    const oldName = r.oldLeadName.substring(0, 25).padEnd(25);
    console.log(`│ ${icon} ${String(r.num).padStart(2)} │ ${r.team.padEnd(10)} │ ${r.pipeline.substring(0, 20).padEnd(20)} │ ${r.oldLeadId} ${oldName} │ ${String(r.daysInStage).padStart(4)}d      │ ${r.rule.substring(0, 12).padEnd(12)} │ ${r.newLeadId ? r.newLeadId : "ERRO"}${" ".repeat(Math.max(0, 11 - String(r.newLeadId || "ERRO").length))} │`);
  }
  console.log("└─────┴────────────┴──────────────────────┴────────────────────────────────┴────────────┴──────────────┴─────────────┘");

  // JSON pra documentação
  console.log(`\n\n📄 DADOS PARA DOCUMENTAÇÃO (JSON):`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => {
  console.error("\n❌ ERRO FATAL:", e.message);
  process.exit(1);
});
