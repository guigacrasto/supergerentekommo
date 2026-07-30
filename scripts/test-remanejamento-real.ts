/**
 * Teste REAL de remanejamento — 1 lead por funil/etapa em cada conta
 * Ignora criterio de dias e data de corte (so pra testar o fluxo)
 *
 * Uso: npx tsx scripts/test-remanejamento-real.ts
 */
import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");
type TeamKey = "azul" | "amarela";

const STAGE_RULES: Record<TeamKey, Array<{ stageName: string; ruleLabel: string }>> = {
  azul: [
    { stageName: "EM ATENDIMENTO", ruleLabel: "R1 (Em Atendimento)" },
    { stageName: "N ATENDEU/ CX POSTAL /SEM RESPOSTA", ruleLabel: "R2 (N Atendeu)" },
  ],
  amarela: [
    { stageName: "CLIENTE INTERESSADO", ruleLabel: "R1 (Cliente Interessado)" },
    { stageName: "n atendeu / cx postal / SEM RESPOSTA", ruleLabel: "R2 (N Atendeu)" },
  ],
};

interface TestResult {
  team: string;
  pipeline: string;
  stage: string;
  rule: string;
  oldLeadId: number;
  oldLeadName: string;
  newLeadId: number;
  status: "OK" | "ERRO";
  error?: string;
}

async function main() {
  console.log("🧪 TESTE REAL DE REMANEJAMENTO — 1 lead por funil");
  console.log(`   Data: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  console.log(`   Modo: 1 lead por funil/etapa que tenha NEW LEADS 2\n`);

  const results: TestResult[] = [];

  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) {
      console.log(`\n⚠️  ${team}: sem subdomain, pulando`);
      continue;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔍 CONTA: ${team.toUpperCase()}`);
    console.log("=".repeat(60));

    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    // Loss reason
    const reasons = await service.getLossReasons();
    const lossReason = reasons.find(r =>
      r.name.toLowerCase().includes("não satisfeito") ||
      r.name.toLowerCase().includes("nao satisfeito")
    );
    console.log(`Loss reason: ${lossReason ? `"${lossReason.name}" (${lossReason.id})` : "NAO ENCONTRADO"}`);

    const pipelines = await service.getPipelines();
    const rules = STAGE_RULES[team];

    for (const pipeline of pipelines) {
      const statuses: Array<{ id: number; name: string }> = pipeline._embedded?.statuses || [];
      const newLeads2 = statuses.find(s => s.name.toUpperCase().includes("NEW LEADS 2"));

      if (!newLeads2) continue; // Pula pipelines sem NEW LEADS 2

      console.log(`\n--- Pipeline: "${pipeline.name}" ---`);

      for (const rule of rules) {
        const targetStatus = statuses.find(
          s => s.name.trim().toUpperCase() === rule.stageName.trim().toUpperCase()
        );

        if (!targetStatus) {
          console.log(`   ⚠️  Etapa "${rule.stageName}" nao existe neste funil`);
          continue;
        }

        console.log(`   🔎 Buscando 1 lead em "${targetStatus.name}"...`);

        // Buscar apenas 1 lead (o mais recente)
        let leads: any[] = [];
        try {
          const res = await service.client.get("/leads", {
            params: {
              limit: 1,
              with: "custom_fields_values,contacts,source_id",
              filter: {
                statuses: [{ pipeline_id: pipeline.id, status_id: targetStatus.id }],
              },
            },
          });
          leads = res.data?._embedded?.leads || [];
        } catch (e: any) {
          console.log(`   ❌ Erro ao buscar leads: ${e.message}`);
          continue;
        }

        if (leads.length === 0) {
          console.log(`   ✅ Nenhum lead nessa etapa — nada pra testar`);
          continue;
        }

        const lead = leads[0];
        const now = Math.floor(Date.now() / 1000);
        const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;
        const daysInStage = Math.floor((now - statusChangedAt) / 86400);

        console.log(`   📋 Lead: ${lead.id} ("${lead.name}") — ${daysInStage}d na etapa`);

        try {
          // 1. Criar novo lead em NEW LEADS 2
          const newLeadData: any = {
            name: lead.name || "Lead Remanejado",
            pipeline_id: pipeline.id,
            status_id: newLeads2.id,
            responsible_user_id: lead.responsible_user_id,
          };
          if (lead.price) newLeadData.price = lead.price;
          if (lead.custom_fields_values) newLeadData.custom_fields_values = lead.custom_fields_values;
          if (lead._embedded?.tags?.length > 0) {
            newLeadData._embedded = { tags: lead._embedded.tags.map((t: any) => ({ name: t.name })) };
          }

          // Tentar com custom fields; se falhar com 400, tenta sem
          let newLead: any;
          try {
            newLead = await service.createLead(newLeadData);
          } catch (cfErr: any) {
            if (cfErr?.response?.status === 400 && newLeadData.custom_fields_values) {
              console.log(`   ⚠️  Custom fields causaram erro 400, tentando sem eles...`);
              delete newLeadData.custom_fields_values;
              newLead = await service.createLead(newLeadData);
            } else {
              throw cfErr;
            }
          }
          console.log(`   ✅ Novo lead criado: ID ${newLead?.id}`);

          // 2. Nota no lead antigo
          await service.addNote(
            lead.id,
            `[SuperGerente] TESTE — Lead remanejado — ${rule.ruleLabel} — Novo lead ID: ${newLead?.id || "?"}`
          );
          console.log(`   ✅ Nota adicionada ao lead ${lead.id}`);

          // 3. Fechar como perdido
          const closed = await service.closeLeadAsLost(lead.id, lossReason?.id);
          console.log(`   ${closed ? "✅" : "❌"} Lead ${lead.id} fechado como venda perdida`);

          results.push({
            team, pipeline: pipeline.name, stage: targetStatus.name, rule: rule.ruleLabel,
            oldLeadId: lead.id, oldLeadName: lead.name || "", newLeadId: newLead?.id || 0, status: "OK",
          });

          // Delay entre operacoes
          await new Promise(r => setTimeout(r, 1000));
        } catch (err: any) {
          console.log(`   ❌ ERRO: ${err.message}`);
          results.push({
            team, pipeline: pipeline.name, stage: targetStatus.name, rule: rule.ruleLabel,
            oldLeadId: lead.id, oldLeadName: lead.name || "", newLeadId: 0, status: "ERRO", error: err.message,
          });
        }
      }
    }
  }

  // Resumo final
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("📊 RESUMO DO TESTE REAL");
  console.log("=".repeat(60));

  if (results.length === 0) {
    console.log("\n⚠️  Nenhum teste executado (nenhum pipeline com as etapas certas + leads)");
  } else {
    const ok = results.filter(r => r.status === "OK").length;
    const err = results.filter(r => r.status === "ERRO").length;
    console.log(`\n✅ ${ok} testes OK | ❌ ${err} com erro\n`);

    for (const r of results) {
      const icon = r.status === "OK" ? "✅" : "❌";
      console.log(`${icon} ${r.team}/${r.pipeline} — ${r.stage} (${r.rule})`);
      console.log(`   Lead antigo: ${r.oldLeadId} ("${r.oldLeadName}") → Lead novo: ${r.newLeadId}`);
      if (r.error) console.log(`   Erro: ${r.error}`);
    }
  }

  console.log("\n🏁 Teste finalizado.");
}

main().catch(e => {
  console.error("\n❌ ERRO FATAL:", e.message);
  process.exit(1);
});
