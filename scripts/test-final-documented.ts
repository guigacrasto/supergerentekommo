/**
 * TESTE FINAL — Remanejamento com contatos vinculados
 * Busca 1 lead novo por regra/funil (diferente dos já movidos) e documenta tudo
 */
import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");
type TeamKey = "azul" | "amarela";

// IDs já movidos no teste anterior — pular esses
const ALREADY_MOVED = new Set([
  32599496, 33198954, 32755116, 41291146, 24803886, 38245391, 35536820, 35327160,
  8980408, 9184988,
]);

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
  oldLeadId: number;
  oldLeadName: string;
  oldResponsibleId: number;
  daysInStage: number;
  noteCount: number;
  contactsLinked: number;
  contactNames: string[];
  newLeadId: number;
  status: "OK" | "ERRO";
  error?: string;
}

async function main() {
  console.log("🧪 TESTE FINAL — REMANEJAMENTO COM CONTATOS");
  console.log(`   Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  console.log(`   Codigo corrigido: contatos vinculados via /link\n`);

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

    const reasons = await service.getLossReasons();
    const lossReason = reasons.find((r: any) =>
      r.name.toLowerCase().includes("não satisfeito") || r.name.toLowerCase().includes("nao satisfeito")
    );

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

        let page = 1;
        let found = false;

        while (page <= 10 && !found) {
          let leads: any[] = [];
          try {
            const res = await service.client.get("/leads", {
              params: {
                limit: 50, page,
                with: "custom_fields_values,contacts,source_id",
                filter: { statuses: [{ pipeline_id: pipeline.id, status_id: targetStatus.id }] },
              },
            });
            leads = res.data?._embedded?.leads || [];
          } catch { break; }
          if (leads.length === 0) break;

          for (const lead of leads) {
            if (lead.pipeline_id !== pipeline.id) continue;
            if (lead.status_id !== targetStatus.id) continue;
            if (ALREADY_MOVED.has(lead.id)) continue;

            if (rule.requiresNoNotes) {
              const notes = await service.getLeadNotes(lead.id);
              if (notes.length > 0) continue;
            }

            num++;
            const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;
            const daysInStage = Math.floor((now - statusChangedAt) / 86400);

            const result: DocResult = {
              num, team, pipeline: pipeline.name, pipelineId: pipeline.id,
              rule: rule.ruleLabel, stageName: targetStatus.name,
              oldLeadId: lead.id, oldLeadName: lead.name || "(sem nome)",
              oldResponsibleId: lead.responsible_user_id, daysInStage, noteCount: 0,
              contactsLinked: 0, contactNames: [], newLeadId: 0, status: "OK",
            };

            console.log(`\n${"─".repeat(70)}`);
            console.log(`📌 #${num} | ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel}`);
            console.log(`${"─".repeat(70)}`);
            console.log(`\n  📋 ANTES:`);
            console.log(`     Lead ID: ${lead.id}`);
            console.log(`     Nome: ${lead.name}`);
            console.log(`     Pipeline: ${pipeline.name} (${pipeline.id})`);
            console.log(`     Etapa: "${targetStatus.name}" (${targetStatus.id})`);
            console.log(`     Responsavel: ${lead.responsible_user_id}`);
            console.log(`     Dias na etapa: ${daysInStage}`);

            // Listar contatos do lead antigo
            const oldContacts = lead._embedded?.contacts || [];
            for (const c of oldContacts) {
              try {
                const cRes = await service.client.get(`/contacts/${c.id}`, { params: { with: "custom_fields_values" } });
                const cData = cRes.data;
                const phone = cData.custom_fields_values?.find((f: any) => f.field_code === "PHONE")?.values?.[0]?.value || "";
                const email = cData.custom_fields_values?.find((f: any) => f.field_code === "EMAIL")?.values?.[0]?.value || "";
                console.log(`     Contato: ${cData.name} | Tel: ${phone} | Email: ${email}`);
                result.contactNames.push(`${cData.name} (${phone})`);
              } catch { }
            }

            try {
              // 1. Criar lead novo
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
                    delete newLeadData.custom_fields_values;
                    newLead = await service.createLead(newLeadData);
                  } else throw cfErr;
                }
              } else {
                newLead = await service.createLead(newLeadData);
              }
              result.newLeadId = newLead?.id || 0;

              // 2. Vincular contatos via /link
              if (newLead?.id && oldContacts.length > 0) {
                for (const contact of oldContacts) {
                  try {
                    await service.client.post(`/leads/${newLead.id}/link`, [
                      { to_entity_id: contact.id, to_entity_type: "contacts" }
                    ]);
                    result.contactsLinked++;
                  } catch (e: any) {
                    console.log(`     ⚠️ Erro ao vincular contato ${contact.id}: ${e.message}`);
                  }
                }
              }

              // 3. Nota no lead antigo
              await service.addNote(lead.id,
                `[SuperGerente] Lead remanejado automaticamente — ${rule.ruleLabel} — ${daysInStage} dias na etapa "${targetStatus.name}" — Novo lead ID: ${newLead?.id || "?"}`
              );

              // 4. Fechar lead antigo
              await service.closeLeadAsLost(lead.id, lossReason?.id);

              console.log(`\n  ✅ DEPOIS:`);
              console.log(`     Lead ANTIGO ${lead.id} → VENDA PERDIDA`);
              console.log(`     Lead NOVO ${newLead?.id} → NEW LEADS 2 (${newLeads2.id})`);
              console.log(`     Contatos vinculados: ${result.contactsLinked}/${oldContacts.length}`);

            } catch (err: any) {
              result.status = "ERRO";
              result.error = err.message;
              console.log(`\n  ❌ ERRO: ${err.message}`);
            }

            results.push(result);
            found = true;
            await new Promise(r => setTimeout(r, 1000));
            break;
          }
          page++;
        }

        if (!found) {
          console.log(`\n⚪ ${team.toUpperCase()} | ${pipeline.name} | ${rule.ruleLabel} — nenhum lead novo encontrado`);
        }
      }
    }
  }

  // RESUMO
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("📊 RESUMO TESTE FINAL");
  console.log("=".repeat(70));

  const ok = results.filter(r => r.status === "OK").length;
  const err = results.filter(r => r.status === "ERRO").length;
  console.log(`\n✅ ${ok} OK | ❌ ${err} ERRO\n`);

  for (const r of results) {
    const icon = r.status === "OK" ? "✅" : "❌";
    console.log(`${icon} #${r.num} | ${r.team} | ${r.pipeline} | ${r.rule}`);
    console.log(`   Antigo: ${r.oldLeadId} ("${r.oldLeadName}") ${r.daysInStage}d → Novo: ${r.newLeadId} | Contatos: ${r.contactsLinked}`);
  }

  console.log(`\n📄 JSON:`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => {
  console.error("\n❌ ERRO FATAL:", e.message);
  process.exit(1);
});
