/**
 * Automacao de remanejamento de leads estagnados
 * Roda 1x/dia as 4h BRT (7h UTC)
 * Tenant: GAME (azul + amarela), todos os funis
 */
import { KommoService } from "./kommo.js";
import { TEAMS, TeamKey } from "../config.js";
import { Resend } from "resend";

const TARGET_HOUR_UTC = 7; // 4h BRT = 7h UTC
const RECIPIENT = "guilherme@onigroup.com.br";

// Data de corte: so processa leads cujo status_changed_at >= esta data
// Leads que ja estavam nas etapas antes disso sao ignorados
const CUTOFF_DATE = new Date("2026-04-01T00:00:00-03:00"); // 01/04/2026 BRT
const CUTOFF_TIMESTAMP = Math.floor(CUTOFF_DATE.getTime() / 1000);

interface StageRule {
  stageName: string;
  days: number;
  requiresNoNotes: boolean;
  ruleLabel: string;
}

const STAGE_RULES: Record<TeamKey, StageRule[]> = {
  azul: [
    { stageName: "EM ATENDIMENTO", days: 10, requiresNoNotes: true, ruleLabel: "R1 (Em Atendimento 10d sem nota)" },
    { stageName: "N ATENDEU/ CX POSTAL /SEM RESPOSTA", days: 15, requiresNoNotes: false, ruleLabel: "R2 (N Atendeu 15d)" },
  ],
  amarela: [
    { stageName: "CLIENTE INTERESSADO", days: 10, requiresNoNotes: true, ruleLabel: "R1 (Cliente Interessado 10d sem nota)" },
    { stageName: "n atendeu / cx postal / SEM RESPOSTA", days: 15, requiresNoNotes: false, ruleLabel: "R2 (N Atendeu 15d)" },
  ],
};

interface RemanejamentoResult {
  date: string;
  team: string;
  pipeline: string;
  oldLeadId: number;
  oldLeadName: string;
  stageOriginal: string;
  ruleApplied: string;
  newLeadId: number;
  daysInStage: number;
}

async function findLossReasonId(service: KommoService): Promise<number | undefined> {
  const reasons = await service.getLossReasons();
  // Busca "nao satisfeito" (motivo escolhido pelo usuario)
  const match = reasons.find(r => r.name.toLowerCase().includes("não satisfeito") || r.name.toLowerCase().includes("nao satisfeito"));
  if (match) {
    console.log(`[LeadRemanejamento] Loss reason found: "${match.name}" (id: ${match.id})`);
    return match.id;
  }
  console.warn(`[LeadRemanejamento] Loss reason "nao satisfeito" not found. Closing without reason.`);
  return undefined;
}

function findNewLeads2StatusId(
  statuses: Array<{ id: number; name: string }>
): number | undefined {
  return statuses.find(s => s.name.toUpperCase().includes("NEW LEADS 2"))?.id;
}

async function processTeam(
  team: TeamKey,
  service: KommoService,
  results: RemanejamentoResult[]
): Promise<void> {
  const rules = STAGE_RULES[team];
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  console.log(`[LeadRemanejamento] Processing team: ${team}`);

  const lossReasonId = await findLossReasonId(service);
  const pipelines = await service.getPipelines();

  for (const pipeline of pipelines) {
    const pipelineName: string = pipeline.name;
    const statuses: Array<{ id: number; name: string }> = pipeline._embedded?.statuses || [];
    const newLeads2StatusId = findNewLeads2StatusId(statuses);

    if (!newLeads2StatusId) {
      console.log(`[LeadRemanejamento] Pipeline "${pipelineName}" (${team}): no "NEW LEADS 2" stage found, skipping`);
      continue;
    }

    for (const rule of rules) {
      const targetStatus = statuses.find(
        s => s.name.trim().toUpperCase() === rule.stageName.trim().toUpperCase()
      );

      if (!targetStatus) {
        console.log(`[LeadRemanejamento] Pipeline "${pipelineName}" (${team}): stage "${rule.stageName}" not found, skipping`);
        continue;
      }

      console.log(`[LeadRemanejamento] Pipeline "${pipelineName}" (${team}): checking stage "${targetStatus.name}" (${rule.ruleLabel})`);

      // Fetch leads in this specific status
      const leads = await service.getLeads({
        filter: {
          statuses: [{ pipeline_id: pipeline.id, status_id: targetStatus.id }],
        },
      });

      console.log(`[LeadRemanejamento] Found ${leads.length} leads in "${targetStatus.name}"`);

      for (const lead of leads) {
        // Verificar se o lead REALMENTE pertence a este pipeline
        if (lead.pipeline_id !== pipeline.id) continue;

        // Check days in stage using status_changed_at (Kommo field, unix timestamp)
        const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;

        // Ignorar leads que entraram na etapa ANTES da data de corte (01/04/2026)
        if (statusChangedAt < CUTOFF_TIMESTAMP) continue;

        const daysInStage = Math.floor((now - statusChangedAt) / 86400);

        if (daysInStage < rule.days) continue;

        // R1: check for zero notes
        if (rule.requiresNoNotes) {
          const notes = await service.getLeadNotes(lead.id);
          if (notes.length > 0) {
            continue; // Has notes, skip
          }
        }

        console.log(`[LeadRemanejamento] Lead ${lead.id} ("${lead.name}") — ${daysInStage}d in "${targetStatus.name}" — remanejando...`);

        try {
          // 1. Create new lead in NEW LEADS 2 with same data
          const newLeadData: any = {
            name: lead.name || "Lead Remanejado",
            pipeline_id: pipeline.id,
            status_id: newLeads2StatusId,
            responsible_user_id: lead.responsible_user_id,
          };
          if (lead.price) newLeadData.price = lead.price;

          // Copiar tags e contatos do lead antigo via _embedded (vincula na criação)
          const embedded: any = {};
          if (lead._embedded?.tags?.length > 0) {
            embedded.tags = lead._embedded.tags.map((t: any) => ({ name: t.name }));
          }
          const contacts = lead._embedded?.contacts;
          if (contacts && contacts.length > 0) {
            embedded.contacts = contacts.map((c: any) => ({ id: c.id }));
          }
          if (Object.keys(embedded).length > 0) {
            newLeadData._embedded = embedded;
          }

          // Copiar custom fields, mas se falhar (ex: campo de escolha invalido), tenta sem eles
          let newLead: any;
          if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            newLeadData.custom_fields_values = lead.custom_fields_values;
            try {
              newLead = await service.createLead(newLeadData);
            } catch (cfErr: any) {
              if (cfErr?.response?.status === 400) {
                console.warn(`[LeadRemanejamento] Lead ${lead.id}: custom fields causaram erro 400, tentando sem eles...`);
                delete newLeadData.custom_fields_values;
                newLead = await service.createLead(newLeadData);
              } else {
                throw cfErr;
              }
            }
          } else {
            newLead = await service.createLead(newLeadData);
          }

          if (newLead?.id && contacts && contacts.length > 0) {
            console.log(`[LeadRemanejamento] ${contacts.length} contato(s) vinculado(s) ao lead ${newLead.id} via _embedded`);
          }

          // 2. Add note to old lead
          await service.addNote(
            lead.id,
            `[SuperGerente] Lead remanejado automaticamente — ${rule.ruleLabel} — ${daysInStage} dias na etapa — Novo lead ID: ${newLead?.id || "?"}`
          );

          // 3. Close old lead as lost
          await service.closeLeadAsLost(lead.id, lossReasonId);

          results.push({
            date: today,
            team: team,
            pipeline: pipelineName,
            oldLeadId: lead.id,
            oldLeadName: lead.name || "",
            stageOriginal: targetStatus.name,
            ruleApplied: rule.ruleLabel,
            newLeadId: newLead?.id || 0,
            daysInStage,
          });

          console.log(`[LeadRemanejamento] Lead ${lead.id} remanejado -> novo lead ${newLead?.id}`);

          // Rate limit: small delay between operations
          await new Promise(r => setTimeout(r, 500));
        } catch (err: any) {
          console.error(`[LeadRemanejamento] Error processing lead ${lead.id}:`, err.message);
        }
      }
    }
  }
}

function buildCsv(results: RemanejamentoResult[]): string {
  const headers = ["Data", "Conta", "Funil", "Lead Antigo ID", "Lead Antigo Nome", "Etapa Original", "Regra Aplicada", "Lead Novo ID", "Dias na Etapa"];
  const escape = (v: string) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const r of results) {
    lines.push([
      r.date, r.team, r.pipeline,
      String(r.oldLeadId), r.oldLeadName, r.stageOriginal,
      r.ruleApplied, String(r.newLeadId), String(r.daysInStage),
    ].map(escape).join(","));
  }
  return "\uFEFF" + lines.join("\n");
}

async function sendReport(results: RemanejamentoResult[]): Promise<void> {
  if (results.length === 0) {
    console.log("[LeadRemanejamento] Nenhum lead remanejado, email nao enviado.");
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@supergerente.com";
  const today = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const csv = buildCsv(results);

  const byTeam = results.reduce((acc, r) => {
    acc[r.team] = (acc[r.team] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const summary = Object.entries(byTeam)
    .map(([team, count]) => `<b>${team.toUpperCase()}</b>: ${count} leads`)
    .join(" | ");

  try {
    await resend.emails.send({
      from: `SuperGerente <${fromEmail}>`,
      to: RECIPIENT,
      subject: `[SuperGerente] Remanejamento automatico — ${today} — ${results.length} leads movidos`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #9566F2; margin-bottom: 16px;">Remanejamento Automatico de Leads</h2>
          <p style="color: #333; line-height: 1.6;"><b>Data:</b> ${today}</p>
          <p style="color: #333; line-height: 1.6;"><b>Total:</b> ${results.length} leads remanejados</p>
          <p style="color: #333; line-height: 1.6;">${summary}</p>
          <div style="background: #F5F3FF; border-left: 4px solid #9566F2; padding: 16px; border-radius: 4px; margin: 16px 0;">
            <p style="color: #333; margin: 0; font-size: 14px;">
              <b>R1:</b> Leads em atendimento ha 10+ dias sem nota<br>
              <b>R2:</b> Leads sem contato ha 15+ dias
            </p>
          </div>
          <p style="color: #333; line-height: 1.6;">Veja a planilha em anexo com todos os detalhes.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">Enviado automaticamente pelo SuperGerente.</p>
        </div>
      `,
      attachments: [{
        filename: `remanejamento-${today.replace(/\//g, "-")}.csv`,
        content: Buffer.from(csv, "utf-8").toString("base64"),
        contentType: "text/csv",
      }],
    });
    console.log(`[LeadRemanejamento] Email enviado para ${RECIPIENT}`);
  } catch (e: any) {
    console.error("[LeadRemanejamento] Erro ao enviar email:", e.message);
  }
}

async function runRemanejamento(): Promise<void> {
  console.log("[LeadRemanejamento] Iniciando remanejamento diario...");
  const startTime = Date.now();
  const results: RemanejamentoResult[] = [];

  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) {
      console.log(`[LeadRemanejamento] ${team}: sem subdomain configurado, pulando`);
      continue;
    }

    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    try {
      await processTeam(team, service, results);
    } catch (e: any) {
      console.error(`[LeadRemanejamento] Erro ao processar ${team}:`, e.message);
    }
  }

  console.log(`[LeadRemanejamento] Total: ${results.length} leads remanejados`);

  await sendReport(results);

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[LeadRemanejamento] Concluido em ${duration}s`);
}

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(TARGET_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function startLeadRemanejamento(): void {
  const ms = msUntilNextRun();
  const hours = Math.round(ms / 3600000 * 10) / 10;
  console.log(`[LeadRemanejamento] Proximo remanejamento em ${hours}h (4h BRT)`);

  setTimeout(() => {
    runRemanejamento().catch(e => console.error("[LeadRemanejamento] Erro:", e.message));

    setInterval(() => {
      runRemanejamento().catch(e => console.error("[LeadRemanejamento] Erro:", e.message));
    }, 24 * 60 * 60 * 1000);
  }, ms);
}
