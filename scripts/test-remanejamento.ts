/**
 * Script de teste do remanejamento de leads
 * Faz dry-run + teste com 1 lead real (com confirmacao)
 *
 * Uso: npx tsx scripts/test-remanejamento.ts
 */

// dotenv MUST load before any other import to ensure env vars are available
import dotenv from "dotenv";
dotenv.config();

// Now safe to import modules that read env vars at module level
const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");
type TeamKey = "azul" | "amarela";

const CUTOFF_DATE = new Date("2026-04-01T00:00:00-03:00");
const CUTOFF_TIMESTAMP = Math.floor(CUTOFF_DATE.getTime() / 1000);

const STAGE_RULES: Record<TeamKey, Array<{ stageName: string; days: number; requiresNoNotes: boolean; ruleLabel: string }>> = {
  azul: [
    { stageName: "EM ATENDIMENTO", days: 10, requiresNoNotes: true, ruleLabel: "R1 (Em Atendimento 10d sem nota)" },
    { stageName: "N ATENDEU/ CX POSTAL /SEM RESPOSTA", days: 15, requiresNoNotes: false, ruleLabel: "R2 (N Atendeu 15d)" },
  ],
  amarela: [
    { stageName: "CLIENTE INTERESSADO", days: 10, requiresNoNotes: true, ruleLabel: "R1 (Cliente Interessado 10d sem nota)" },
    { stageName: "n atendeu / cx postal / SEM RESPOSTA", days: 15, requiresNoNotes: false, ruleLabel: "R2 (N Atendeu 15d)" },
  ],
};

interface Candidate {
  team: TeamKey;
  pipelineName: string;
  pipelineId: number;
  leadId: number;
  leadName: string;
  stageName: string;
  stageId: number;
  newLeads2StatusId: number;
  daysInStage: number;
  notesCount: number;
  rule: string;
  service: KommoService;
}

async function dryRun(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) {
      console.log(`\n⚠️  ${team}: sem subdomain configurado, pulando`);
      continue;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔍 CONTA: ${team.toUpperCase()} (${TEAMS[team].subdomain})`);
    console.log("=".repeat(60));

    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    // 1. Verificar loss reason
    const reasons = await service.getLossReasons();
    const lossReason = reasons.find(r => r.name.toLowerCase().includes("não satisfeito") || r.name.toLowerCase().includes("nao satisfeito"));
    if (lossReason) {
      console.log(`✅ Loss reason encontrado: "${lossReason.name}" (id: ${lossReason.id})`);
    } else {
      console.log(`❌ Loss reason "nao satisfeito" NAO encontrado!`);
      console.log(`   Motivos disponiveis: ${reasons.map(r => `"${r.name}" (${r.id})`).join(", ")}`);
    }

    // 2. Verificar pipelines e etapas
    const pipelines = await service.getPipelines();
    console.log(`\n📊 ${pipelines.length} pipelines encontrados\n`);

    const rules = STAGE_RULES[team];

    for (const pipeline of pipelines) {
      const statuses: Array<{ id: number; name: string }> = pipeline._embedded?.statuses || [];
      const newLeads2 = statuses.find(s => s.name.toUpperCase().includes("NEW LEADS 2"));

      console.log(`\n--- Pipeline: "${pipeline.name}" (${pipeline.id}) ---`);
      console.log(`    Etapas: ${statuses.map(s => `"${s.name}"`).join(", ")}`);

      if (!newLeads2) {
        console.log(`    ⚠️  Sem etapa "NEW LEADS 2" — pulando`);
        continue;
      }
      console.log(`    ✅ NEW LEADS 2 encontrado (id: ${newLeads2.id})`);

      for (const rule of rules) {
        const targetStatus = statuses.find(
          s => s.name.trim().toUpperCase() === rule.stageName.trim().toUpperCase()
        );

        if (!targetStatus) {
          console.log(`    ⚠️  Etapa "${rule.stageName}" nao encontrada`);
          continue;
        }

        console.log(`    🔎 Verificando "${targetStatus.name}" (${rule.ruleLabel})...`);

        // Buscar leads nessa etapa
        const leads = await service.getLeads({
          filter: {
            statuses: [{ pipeline_id: pipeline.id, status_id: targetStatus.id }],
          },
        });

        console.log(`       ${leads.length} leads nessa etapa`);

        let candidateCount = 0;
        let skippedCutoff = 0;
        for (const lead of leads) {
          const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;

          // Ignorar leads anteriores a data de corte (01/04/2026)
          if (statusChangedAt < CUTOFF_TIMESTAMP) {
            skippedCutoff++;
            continue;
          }

          const daysInStage = Math.floor((now - statusChangedAt) / 86400);

          if (daysInStage < rule.days) continue;

          let notesCount = 0;
          if (rule.requiresNoNotes) {
            const notes = await service.getLeadNotes(lead.id);
            notesCount = notes.length;
            if (notesCount > 0) continue;
          }

          candidateCount++;
          candidates.push({
            team,
            pipelineName: pipeline.name,
            pipelineId: pipeline.id,
            leadId: lead.id,
            leadName: lead.name || "(sem nome)",
            stageName: targetStatus.name,
            stageId: targetStatus.id,
            newLeads2StatusId: newLeads2.id,
            daysInStage,
            notesCount,
            rule: rule.ruleLabel,
            service,
          });
        }

        if (skippedCutoff > 0) {
          console.log(`       ⏭️  ${skippedCutoff} leads ignorados (anteriores a 01/04/2026)`);
        }
        if (candidateCount > 0) {
          console.log(`       🎯 ${candidateCount} leads CANDIDATOS ao remanejamento`);
        } else {
          console.log(`       ✅ Nenhum lead se enquadra na regra (apos data de corte)`);
        }
      }
    }
  }

  return candidates;
}

async function testWithOneLead(candidate: Candidate): Promise<void> {
  const { service, team } = candidate;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🧪 TESTE REAL — Remanejando 1 lead`);
  console.log("=".repeat(60));
  console.log(`   Lead: ${candidate.leadId} ("${candidate.leadName}")`);
  console.log(`   Conta: ${team}`);
  console.log(`   Funil: ${candidate.pipelineName}`);
  console.log(`   Etapa: ${candidate.stageName} (${candidate.daysInStage} dias)`);
  console.log(`   Regra: ${candidate.rule}`);
  console.log(`   Destino: NEW LEADS 2 (status_id: ${candidate.newLeads2StatusId})`);

  // Buscar dados completos do lead
  const leadDetails = await service.getLeadDetails(candidate.leadId);
  console.log(`\n   📋 Dados do lead:`);
  console.log(`      Nome: ${leadDetails.name}`);
  console.log(`      Responsavel: ${leadDetails.responsible_user_id}`);
  console.log(`      Valor: ${leadDetails.price || "—"}`);
  console.log(`      Custom fields: ${leadDetails.custom_fields_values?.length || 0}`);
  console.log(`      Tags: ${leadDetails._embedded?.tags?.map((t: any) => t.name).join(", ") || "—"}`);

  // Loss reason
  const reasons = await service.getLossReasons();
  const lossReason = reasons.find(r => r.name.toLowerCase().includes("desqualificado"));

  console.log(`\n   ▶️  Executando remanejamento...`);

  // 1. Criar novo lead
  const newLeadData: any = {
    name: leadDetails.name || "Lead Remanejado",
    pipeline_id: candidate.pipelineId,
    status_id: candidate.newLeads2StatusId,
    responsible_user_id: leadDetails.responsible_user_id,
  };
  if (leadDetails.price) newLeadData.price = leadDetails.price;
  if (leadDetails.custom_fields_values) newLeadData.custom_fields_values = leadDetails.custom_fields_values;
  if (leadDetails._embedded?.tags?.length > 0) {
    newLeadData._embedded = { tags: leadDetails._embedded.tags.map((t: any) => ({ name: t.name })) };
  }

  const newLead = await service.createLead(newLeadData);
  console.log(`   ✅ Novo lead criado: ID ${newLead?.id}`);

  // 2. Nota no lead antigo
  await service.addNote(
    candidate.leadId,
    `[SuperGerente] Lead remanejado automaticamente — ${candidate.rule} — ${candidate.daysInStage} dias na etapa — Novo lead ID: ${newLead?.id || "?"}`
  );
  console.log(`   ✅ Nota adicionada ao lead antigo ${candidate.leadId}`);

  // 3. Fechar como perdido
  const closed = await service.closeLeadAsLost(candidate.leadId, lossReason?.id);
  console.log(`   ${closed ? "✅" : "❌"} Lead antigo ${candidate.leadId} fechado como venda perdida`);

  console.log(`\n   🎉 TESTE CONCLUIDO COM SUCESSO!`);
  console.log(`   Lead antigo: ${candidate.leadId} → fechado como perdido`);
  console.log(`   Lead novo: ${newLead?.id} → em NEW LEADS 2`);
}

async function main() {
  console.log("🚀 TESTE DE REMANEJAMENTO DE LEADS — SuperGerente");
  console.log(`   Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  console.log(`   Modo: DRY-RUN + teste com 1 lead`);

  // Phase 1: Dry-run
  console.log("\n\n📋 FASE 1: DRY-RUN (apenas verificacao)\n");
  const candidates = await dryRun();

  // Summary
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("📊 RESUMO DO DRY-RUN");
  console.log("=".repeat(60));

  if (candidates.length === 0) {
    console.log("\n✅ Nenhum lead se enquadra nas regras de remanejamento.");
    console.log("   Isso pode significar:");
    console.log("   - Nenhum lead esta ha tempo suficiente nas etapas-alvo");
    console.log("   - Todos os leads nessas etapas tem notas (R1)");
    console.log("   - As etapas nao existem nos pipelines");
    process.exit(0);
  }

  console.log(`\n🎯 ${candidates.length} leads candidatos ao remanejamento:\n`);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`   [${i + 1}] Lead ${c.leadId} ("${c.leadName}") — ${c.team}/${c.pipelineName} — ${c.stageName} — ${c.daysInStage}d — ${c.rule}`);
  }

  // Phase 2: Teste real com o primeiro candidato
  console.log(`\n\n📋 FASE 2: TESTE REAL com lead #1\n`);
  console.log(`⚠️  Sera remanejado: Lead ${candidates[0].leadId} ("${candidates[0].leadName}")`);
  console.log(`   Para cancelar, pressione Ctrl+C agora (5 segundos)...\n`);

  await new Promise(r => setTimeout(r, 5000));

  await testWithOneLead(candidates[0]);
}

main().catch(e => {
  console.error("\n❌ ERRO:", e.message);
  process.exit(1);
});
