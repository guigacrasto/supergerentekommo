# Lead Remanejamento Automation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate lead reassignment for stagnant leads in GAME tenant (azul + amarela), creating new leads in NEW LEADS 2 and closing originals as lost, with daily CSV email report.

**Architecture:** Timer-based service (same pattern as daily-backup.ts) running at 4h BRT. Iterates all pipelines per team, matches target stages by name, checks conditions (days + notes), then creates new lead + closes old one. Results accumulated and emailed as CSV.

**Tech Stack:** TypeScript, KommoService (existing), Resend (email with CSV), setInterval/setTimeout scheduling.

---

### Task 1: Add `createLead` method to KommoService

**Files:**
- Modify: `src/services/kommo.ts:536` (before closing brace of class)

**Step 1: Add the createLead method**

Add this method to the `KommoService` class at the end (before the closing `}`):

```typescript
public async createLead(data: {
    name: string;
    pipeline_id: number;
    status_id: number;
    responsible_user_id?: number;
    price?: number;
    custom_fields_values?: any[];
    _embedded?: { tags?: Array<{ name: string }> };
}): Promise<any> {
    try {
        const response = await this.client.post("/leads", [data]);
        const created = response.data?._embedded?.leads?.[0];
        console.log(`[KommoService:${this.team}] Lead created: ${created?.id} in pipeline ${data.pipeline_id}`);
        return created;
    } catch (error: any) {
        console.error(`[KommoService:${this.team}] Error creating lead:`, error.message);
        throw error;
    }
}
```

**Step 2: Verify build compiles**

Run: `cd /Users/guicrasto/supergerente && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/services/kommo.ts
git commit -m "feat(kommo): add createLead method for lead remanejamento"
```

---

### Task 2: Create the lead-remanejamento service

**Files:**
- Create: `src/services/lead-remanejamento.ts`

**Step 1: Create the service file**

```typescript
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
  const match = reasons.find(r => r.name.toLowerCase().includes("desqualificado"));
  if (match) {
    console.log(`[LeadRemanejamento] Loss reason found: "${match.name}" (id: ${match.id})`);
    return match.id;
  }
  console.warn(`[LeadRemanejamento] Loss reason "desqualificado" not found. Closing without reason.`);
  return undefined;
}

function findTargetStageId(
  statuses: Array<{ id: number; name: string }>,
  targetName: string
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
    const newLeads2StatusId = findTargetStageId(statuses, "NEW LEADS 2");

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
        // Check days in stage using status_changed_at (Kommo field, unix timestamp)
        const statusChangedAt = lead.status_changed_at || lead.updated_at || lead.created_at;
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
          if (lead.custom_fields_values) newLeadData.custom_fields_values = lead.custom_fields_values;
          if (lead._embedded?.tags?.length > 0) {
            newLeadData._embedded = { tags: lead._embedded.tags.map((t: any) => ({ name: t.name })) };
          }

          const newLead = await service.createLead(newLeadData);

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
        type: "text/csv" as const,
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
```

**Step 2: Verify build compiles**

Run: `cd /Users/guicrasto/supergerente && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/services/lead-remanejamento.ts
git commit -m "feat: add lead remanejamento automation service"
```

---

### Task 3: Register the service in startup

**Files:**
- Modify: `src/api/index.ts:11` (add import)
- Modify: `src/api/index.ts:126` (add startup call)

**Step 1: Add import at line 11**

After the `startDailyBackup` import, add:

```typescript
import { startLeadRemanejamento } from "../services/lead-remanejamento.js";
```

**Step 2: Add startup call at line 126**

After `startDailyBackup();`, add:

```typescript
  // Start lead remanejamento automation (4h BRT daily)
  startLeadRemanejamento();
```

**Step 3: Verify build compiles**

Run: `cd /Users/guicrasto/supergerente && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/api/index.ts
git commit -m "feat: register lead remanejamento in startup scheduler"
```

---

### Task 4: Test locally and validate

**Step 1: Start the server locally**

Run: `cd /Users/guicrasto/supergerente && npm run dev`
Expected: Logs show `[LeadRemanejamento] Proximo remanejamento em Xh (4h BRT)`

**Step 2: Verify no runtime errors**

Check that the server starts without errors and all existing services still initialize correctly.

**Step 3: Final commit with changelog update**

Update `docs/changelog.md` with the new automation entry, then commit.

```bash
git add docs/changelog.md
git commit -m "docs: add lead remanejamento to changelog"
```
