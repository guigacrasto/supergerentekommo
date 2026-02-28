# Activity Panel + Smart Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add a "Painel de Alertas" tab showing leads without recent activity and overdue tasks (with clickable Kommo links), and upgrade the chat assistant with activity data + proactive analytical instructions.

**Architecture:** Backend adds `activeLeads` to the existing CRM cache (zero extra API calls), then `activity-cache.ts` uses that data + one `/tasks` API call to compute alerts. New `/api/reports/activity` endpoint serves the frontend tab. Chat system prompt is expanded with activity context and executive analysis instructions.

**Tech Stack:** TypeScript, Express, React 18, Lucide React (`AlertTriangle`), Kommo REST API v4 (`/tasks`), CSS in `web/src/index.css`.

---

### Task 1: Add `activeLeads` to `CrmMetrics` in the CRM cache

**Files:**
- Modify: `src/api/cache/crm-cache.ts`

**Context:** `CrmMetrics` currently stores aggregate counts only. The activity cache needs the raw list of active leads (not won/lost) with their IDs, names, responsible user info, and `updated_at` timestamp — all already available in `fetchAndCompute` without any new API calls. We add this as a new field.

**Step 1: Add `ActiveLead` interface and `activeLeads` field to `CrmMetrics`**

In `src/api/cache/crm-cache.ts`, find the `CrmMetrics` interface (around line 30) and add `ActiveLead` above it, then add `activeLeads` to `CrmMetrics`:

```typescript
export interface ActiveLead {
  id: number;
  titulo: string;
  responsibleUserId: number;
  responsibleUserName: string;
  updatedAt: number; // Unix timestamp (seconds)
}

export interface CrmMetrics {
  funis: Record<string, FunilMetrics>;
  vendedores: VendedorMetrics[];
  geral: {
    total: number;
    ganhos: number;
    perdidos: number;
    ativos: number;
    conversao: string;
    novosHoje: number;
    novosSemana: number;
    novosMes: number;
  };
  activeLeads: ActiveLead[];   // ← ADD THIS
  atualizadoEm: string;
}
```

**Step 2: Populate `activeLeads` in `fetchAndCompute`**

Find the `const geral = { ... }` block (around line 151). After it, before the `console.log(...)` line, add:

```typescript
  const userMap = new Map<number, string>(users.map((u: any) => [u.id, u.name]));
  const activeLeads: ActiveLead[] = allLeads
    .filter((l) => l.status_id !== STATUS.WON && l.status_id !== STATUS.LOST)
    .map((l) => ({
      id: l.id,
      titulo: l.name || `Lead ${l.id}`,
      responsibleUserId: l.responsible_user_id,
      responsibleUserName: userMap.get(l.responsible_user_id) || "Desconhecido",
      updatedAt: l.updated_at ?? 0,
    }));
```

**Step 3: Add `activeLeads` to the return value**

In `fetchAndCompute`, find the `return { funis, vendedores, geral, atualizadoEm: ... }` and add `activeLeads`:

```typescript
  return {
    funis,
    vendedores,
    geral,
    activeLeads,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
```

**Step 4: Add `activeLeads: []` to the early-return (empty pipeline case)**

Find the early return around line 85–90 (when no pipelines found):

```typescript
    return {
      funis: {},
      vendedores: [],
      geral: { total: 0, ganhos: 0, perdidos: 0, ativos: 0, conversao: "0.0%", novosHoje: 0, novosSemana: 0, novosMes: 0 },
      activeLeads: [],   // ← ADD THIS
      atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };
```

**Step 5: Build to verify no TypeScript errors**

```bash
cd /Users/guicrasto/antigravity-gui/kommo-mcp-agent && npm run build
```
Expected: zero errors.

**Step 6: Commit**

```bash
git add src/api/cache/crm-cache.ts
git commit -m "feat: add activeLeads list to CrmMetrics for activity analysis"
```

---

### Task 2: Create `activity-cache.ts`

**Files:**
- Create: `src/api/cache/activity-cache.ts`

**Context:** `KommoService.client` is a public axios instance with auth headers already set. We use it directly to call `/tasks` (no new method needed on KommoService). The `updated_at` field on leads tells us the last time anything happened to a lead (note, stage change, etc.). `TEAMS[team].subdomain` gives us the subdomain for building Kommo URLs. Cache pattern is identical to `crm-cache.ts`.

**Step 1: Create `src/api/cache/activity-cache.ts` with this full content**

```typescript
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { CrmMetrics } from "./crm-cache.js";

export interface AlertLead {
  id: number;
  nome: string;
  vendedor: string;
  diasSemAtividade: number;
  kommoUrl: string;
}

export interface AlertTask {
  id: number;
  texto: string;
  vendedor: string;
  leadId: number;
  leadNome: string;
  diasVencida: number;
  kommoUrl: string;
}

export interface ActivityMetrics {
  leadsAbandonados48h: AlertLead[];
  leadsEmRisco7d: AlertLead[];
  tarefasVencidas: AlertTask[];
  atualizadoEm: string;
}

const ACTIVITY_CACHE_TTL_MS = 30 * 60 * 1000;

interface ActivityCacheEntry {
  metrics: ActivityMetrics | null;
  expiresAt: number;
  fetchPromise: Promise<ActivityMetrics> | null;
}

const activityCaches: Record<TeamKey, ActivityCacheEntry> = {
  azul: { metrics: null, expiresAt: 0, fetchPromise: null },
  amarela: { metrics: null, expiresAt: 0, fetchPromise: null },
};

async function fetchActivity(
  team: TeamKey,
  service: KommoService,
  crmMetrics: CrmMetrics
): Promise<ActivityMetrics> {
  console.log(`[ActivityCache:${team}] Buscando dados de atividade...`);

  const subdomain = TEAMS[team].subdomain;
  const now = Math.floor(Date.now() / 1000);
  const cutoff48h = now - 48 * 3600;
  const cutoff7d = now - 7 * 24 * 3600;

  const activeLeads = crmMetrics.activeLeads;

  // Leads without activity in last 48h
  const leadsAbandonados48h: AlertLead[] = activeLeads
    .filter((l) => l.updatedAt < cutoff48h)
    .map((l) => ({
      id: l.id,
      nome: l.titulo,
      vendedor: l.responsibleUserName,
      diasSemAtividade: Math.floor((now - l.updatedAt) / 86400),
      kommoUrl: `https://${subdomain}.kommo.com/leads/detail/${l.id}`,
    }))
    .sort((a, b) => b.diasSemAtividade - a.diasSemAtividade)
    .slice(0, 30);

  // Leads without activity in last 7 days (superset of 48h)
  const leadsEmRisco7d: AlertLead[] = activeLeads
    .filter((l) => l.updatedAt < cutoff7d)
    .map((l) => ({
      id: l.id,
      nome: l.titulo,
      vendedor: l.responsibleUserName,
      diasSemAtividade: Math.floor((now - l.updatedAt) / 86400),
      kommoUrl: `https://${subdomain}.kommo.com/leads/detail/${l.id}`,
    }))
    .sort((a, b) => b.diasSemAtividade - a.diasSemAtividade)
    .slice(0, 30);

  // Overdue tasks — single API call
  let tarefasVencidas: AlertTask[] = [];
  try {
    const tasksRes = await service.client.get("/tasks", {
      params: { filter: { is_completed: 0, entity_type: "leads" }, limit: 250 },
    });
    const tasks: any[] = tasksRes.data?._embedded?.tasks || [];

    const leadNameMap = new Map<number, string>(
      activeLeads.map((l) => [l.id, l.titulo])
    );
    const userNameMap = new Map<number, string>(
      activeLeads.map((l) => [l.responsibleUserId, l.responsibleUserName])
    );

    tarefasVencidas = tasks
      .filter((t) => t.complete_till > 0 && t.complete_till < now)
      .map((t) => ({
        id: t.id,
        texto: t.text || "Tarefa",
        vendedor: userNameMap.get(t.responsible_user_id) || `User ${t.responsible_user_id}`,
        leadId: t.entity_id,
        leadNome: leadNameMap.get(t.entity_id) || `Lead ${t.entity_id}`,
        diasVencida: Math.max(0, Math.floor((now - t.complete_till) / 86400)),
        kommoUrl: `https://${subdomain}.kommo.com/leads/detail/${t.entity_id}`,
      }))
      .sort((a, b) => b.diasVencida - a.diasVencida)
      .slice(0, 30);
  } catch (err: any) {
    console.error(`[ActivityCache:${team}] Erro ao buscar tarefas:`, err.message);
  }

  console.log(
    `[ActivityCache:${team}] ${leadsAbandonados48h.length} abandonados, ${leadsEmRisco7d.length} em risco, ${tarefasVencidas.length} tarefas vencidas`
  );

  return {
    leadsAbandonados48h,
    leadsEmRisco7d,
    tarefasVencidas,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

export async function getActivityMetrics(
  team: TeamKey,
  service: KommoService,
  crmMetrics: CrmMetrics
): Promise<ActivityMetrics> {
  const entry = activityCaches[team];
  const now = Date.now();

  if (entry.metrics && now < entry.expiresAt) return entry.metrics;

  if (entry.metrics && !entry.fetchPromise) {
    entry.fetchPromise = fetchActivity(team, service, crmMetrics)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + ACTIVITY_CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[ActivityCache:${team}] Erro no refresh:`, err);
        return entry.metrics!;
      })
      .finally(() => { entry.fetchPromise = null; });
    return entry.metrics;
  }

  if (!entry.fetchPromise) {
    entry.fetchPromise = fetchActivity(team, service, crmMetrics)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + ACTIVITY_CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[ActivityCache:${team}] Erro no fetch inicial:`, err);
        throw err;
      })
      .finally(() => { entry.fetchPromise = null; });
  }

  return entry.fetchPromise;
}
```

**Step 2: Build**

```bash
cd /Users/guicrasto/antigravity-gui/kommo-mcp-agent && npm run build
```
Expected: zero TypeScript errors.

**Step 3: Commit**

```bash
git add src/api/cache/activity-cache.ts
git commit -m "feat: add activity-cache for leads without activity and overdue tasks"
```

---

### Task 3: Add `GET /api/reports/activity` endpoint

**Files:**
- Modify: `src/api/routes/reports.ts`

**Context:** Same pattern as `/summary`. Add before `return router;` (line 98). Import `getActivityMetrics` and `ActivityMetrics` from the new cache file.

**Step 1: Add imports at the top of `src/api/routes/reports.ts`**

After line 5 (`import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";`), add:

```typescript
import { getActivityMetrics, ActivityMetrics } from "../cache/activity-cache.js";
import { getCrmMetrics } from "../cache/crm-cache.js";
```

Note: `getCrmMetrics` is already imported on line 4 — do NOT add it again. Only add `getActivityMetrics` and `ActivityMetrics`.

**Step 2: Add the `/activity` route before `return router;`**

Insert this block immediately before `return router;` (line 98):

```typescript
  // GET /api/reports/activity — leads sem atividade e tarefas vencidas por equipe
  router.get("/activity", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    try {
      const result: Array<{
        team: TeamKey;
        label: string;
        activity: ActivityMetrics;
      }> = [];

      for (const team of userTeams) {
        const service = services[team];
        if (!service) continue;

        const crmMetrics = await getCrmMetrics(team, service);
        const activity = await getActivityMetrics(team, service, crmMetrics);
        result.push({ team, label: team === "azul" ? "Equipe Azul" : "Equipe Amarela", activity });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
```

**Step 3: Build**

```bash
cd /Users/guicrasto/antigravity-gui/kommo-mcp-agent && npm run build
```
Expected: zero errors.

**Step 4: Commit**

```bash
git add src/api/routes/reports.ts
git commit -m "feat: add /api/reports/activity endpoint for alerts panel"
```

---

### Task 4: Upgrade chat — activity data + analytical instructions

**Files:**
- Modify: `src/api/routes/chat.ts`

**Context:** `buildSystemPrompt` currently takes only `allMetrics`. We add a second parameter `allActivity` and a new section + analytical instructions. The route handler fetches activity metrics alongside CRM metrics.

**Step 1: Add imports at the top of `src/api/routes/chat.ts`**

After the existing imports (line 8), add:

```typescript
import { getActivityMetrics, ActivityMetrics } from "../cache/activity-cache.js";
```

**Step 2: Replace `buildSystemPrompt` function signature and add activity section + instructions**

Find `function buildSystemPrompt(...)` (line 18) and replace the entire function with:

```typescript
function buildSystemPrompt(
  allMetrics: Array<{ team: string; label: string; metrics: CrmMetrics }>,
  allActivity: Array<{ team: string; activity: ActivityMetrics }>
): string {
  const activityMap = new Map(allActivity.map((a) => [a.team, a.activity]));

  const sections = allMetrics.map(({ team, label, metrics }) => {
    const { funis, vendedores, geral } = metrics;
    const activity = activityMap.get(team);

    const funisTexto = Object.values(funis)
      .map(
        (f) =>
          `  ${f.nome}: ${f.total} leads | ganhos: ${f.ganhos} | perdidos: ${f.perdidos} | ativos: ${f.ativos} | conversão: ${f.conversao} | novos hoje: ${f.novosHoje} | novos semana: ${f.novosSemana} | novos mês: ${f.novosMes}`
      )
      .join("\n");

    const vendedoresTexto = vendedores
      .map(
        (v) =>
          `  ${v.nome} | ${v.funil} | total: ${v.total} | ganhos: ${v.ganhos} | perdidos: ${v.perdidos} | ativos: ${v.ativos} | conversão: ${v.conversao} | novos semana: ${v.novosSemana} | novos mês: ${v.novosMes}`
      )
      .join("\n");

    let activityTexto = "";
    if (activity) {
      const ab = activity.leadsAbandonados48h;
      const risco = activity.leadsEmRisco7d;
      const tarefas = activity.tarefasVencidas;
      activityTexto = `
ALERTAS DE ATIVIDADE (${activity.atualizadoEm}):
  Leads sem atividade há +48h: ${ab.length}${ab.length > 0 ? " — " + ab.slice(0, 5).map((l) => `${l.nome} (${l.vendedor}, ${l.diasSemAtividade}d)`).join(", ") + (ab.length > 5 ? ` e mais ${ab.length - 5}` : "") : ""}
  Leads em risco (sem atividade +7d): ${risco.length}${risco.length > 0 ? " — " + risco.slice(0, 5).map((l) => `${l.nome} (${l.vendedor}, ${l.diasSemAtividade}d)`).join(", ") + (risco.length > 5 ? ` e mais ${risco.length - 5}` : "") : ""}
  Tarefas vencidas: ${tarefas.length}${tarefas.length > 0 ? " — " + tarefas.slice(0, 5).map((t) => `${t.texto} (${t.vendedor}, ${t.diasVencida}d vencida)`).join(", ") + (tarefas.length > 5 ? ` e mais ${tarefas.length - 5}` : "") : ""}`;
    }

    return `## ${label.toUpperCase()} — ATUALIZADO EM: ${metrics.atualizadoEm}

RESUMO GERAL: ${geral.total} leads | ganhos: ${geral.ganhos} | perdidos: ${geral.perdidos} | ativos: ${geral.ativos} | conversão: ${geral.conversao} | novos hoje: ${geral.novosHoje}

MÉTRICAS POR FUNIL:
${funisTexto}

MÉTRICAS POR VENDEDOR × FUNIL:
${vendedoresTexto}
${activityTexto}`;
  });

  return `Você é o assistente analítico de CRM da empresa. Responda gerentes com precisão, profissionalismo e análise aprofundada.

${sections.join("\n\n---\n\n")}

## REGRAS GERAIS
- Responda SEMPRE em Português Brasil.
- Use Markdown (tabelas, negrito, listas) para formatar respostas.
- Baseie suas respostas EXCLUSIVAMENTE nos dados acima.
- Se não tiver o dado solicitado, informe claramente que não está disponível.
- Para rankings, ordene do maior para o menor.
- Conversão = ganhos ÷ (ganhos + perdidos) × 100.

## MODO ANALÍTICO — SEMPRE APLIQUE
- Ao analisar performance, identifique os **TOP 3 INSIGHTS** mais relevantes antes de responder.
- Faça **COMPARATIVOS** sempre que possível: funil A vs. B, agente X vs. média, esta semana vs. mês.
- Identifique **ANOMALIAS**: agentes muito acima ou abaixo da média, funis com conversão muito baixa.
- Conclua análises com uma **RECOMENDAÇÃO DE AÇÃO** clara e objetiva.
- Para perguntas sobre acompanhamento: use os dados de ALERTAS DE ATIVIDADE acima.
- Use tom executivo: direto, baseado em dados, orientado a resultado.`;
}
```

**Step 3: Update the `chatRouter` to fetch activity and pass to `buildSystemPrompt`**

Find these lines in `chatRouter` (around lines 78–88):

```typescript
      const allMetrics = await Promise.all(
        userTeams
          .filter((t) => services[t])
          .map(async (t) => ({
            team: t,
            label: TEAMS[t].label,
            metrics: await getCrmMetrics(t, services[t]),
          }))
      );
      const systemPrompt = buildSystemPrompt(allMetrics);
```

Replace with:

```typescript
      const metricsPerTeam = await Promise.all(
        userTeams
          .filter((t) => services[t])
          .map(async (t) => {
            const crmMetrics = await getCrmMetrics(t, services[t]);
            const activity = await getActivityMetrics(t, services[t], crmMetrics);
            return { team: t, label: TEAMS[t].label, crmMetrics, activity };
          })
      );
      const allMetrics = metricsPerTeam.map((m) => ({
        team: m.team,
        label: m.label,
        metrics: m.crmMetrics,
      }));
      const allActivity = metricsPerTeam.map((m) => ({
        team: m.team,
        activity: m.activity,
      }));
      const systemPrompt = buildSystemPrompt(allMetrics, allActivity);
```

**Step 4: Build**

```bash
cd /Users/guicrasto/antigravity-gui/kommo-mcp-agent && npm run build
```
Expected: zero errors.

**Step 5: Commit**

```bash
git add src/api/routes/chat.ts
git commit -m "feat: expand chat with activity alerts and analytical instructions"
```

---

### Task 5: Frontend — Painel de Alertas tab + CSS

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/index.css`

**Context:** The sidebar "Principal" group (lines 711–731 of `App.tsx`) has Chat, Resumo Geral, and Relatório Agentes buttons. We add "Painel de Alertas" between Resumo Geral and Relatório Agentes. `loadTabData` is at line 294. `renderContent` summary block is at line 519. New alerts block goes after the summary block, before `const currentPipe`.

**Step 1: Add `AlertTriangle` to lucide-react imports (line 3–18 of `App.tsx`)**

```typescript
import {
    MessageSquare,
    BarChart3,
    Settings,
    LogOut,
    ChevronRight,
    ChevronDown,
    Send,
    CheckCircle2,
    XCircle,
    HelpCircle,
    Filter,
    RefreshCw,
    PieChart,
    AlertTriangle,   // ← ADD
    Clock
} from 'lucide-react';
```

**Step 2: Add `alerts` case in `loadTabData` (after the `summary` case, around line 311)**

Find:
```typescript
            } else if (tab === 'summary') {
                res = await axios.get('/api/reports/summary', {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                setTabData(res.data);
            } else if (tab.startsWith('brand-')) {
```

Replace the `} else if (tab.startsWith('brand-')) {` opening with:
```typescript
            } else if (tab === 'alerts') {
                res = await axios.get('/api/reports/activity', {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                setTabData(res.data);
            } else if (tab.startsWith('brand-')) {
```

**Step 3: Add `alerts` rendering block in `renderContent()`**

Find the line `if (activeTab === 'summary') {` (around line 519). Just after the entire summary block's closing `}` and before `const currentPipe = ...`, insert:

```tsx
        if (activeTab === 'alerts') {
            const alertsData: Array<{
                team: string;
                label: string;
                activity: {
                    leadsAbandonados48h: Array<{ id: number; nome: string; vendedor: string; diasSemAtividade: number; kommoUrl: string }>;
                    leadsEmRisco7d: Array<{ id: number; nome: string; vendedor: string; diasSemAtividade: number; kommoUrl: string }>;
                    tarefasVencidas: Array<{ id: number; texto: string; vendedor: string; leadId: number; leadNome: string; diasVencida: number; kommoUrl: string }>;
                };
            }> = Array.isArray(tabData) ? tabData : [];

            const totalAlertas = alertsData.reduce(
                (sum, t) => sum + t.activity.leadsAbandonados48h.length + t.activity.tarefasVencidas.length,
                0
            );

            return (
                <div className="tab-view">
                    <header className="view-header">
                        <div className="title-area">
                            <h1>Painel de Alertas</h1>
                        </div>
                    </header>
                    <section className="view-body">
                        {loading ? (
                            <div className="loading">
                                <RefreshCw className="spin" />
                                <span>Carregando alertas...</span>
                            </div>
                        ) : alertsData.length === 0 ? (
                            <div className="empty">Nenhum dado disponível.</div>
                        ) : totalAlertas === 0 ? (
                            <div className="alerts-all-clear glass">
                                <CheckCircle2 size={40} />
                                <p>Tudo em dia! Nenhum alerta no momento.</p>
                            </div>
                        ) : (
                            <div className="alerts-content">
                                {alertsData.map(({ team, label, activity }) => (
                                    <div key={team} className="alerts-team-section">
                                        <h2 className={`alerts-team-title ${team}`}>{label}</h2>

                                        {activity.leadsAbandonados48h.length > 0 && (
                                            <div className="alert-section alert-red">
                                                <div className="alert-section-header">
                                                    <AlertTriangle size={16} />
                                                    <span>Sem atividade há +48h — {activity.leadsAbandonados48h.length} lead{activity.leadsAbandonados48h.length !== 1 ? 's' : ''}</span>
                                                </div>
                                                {activity.leadsAbandonados48h.map((lead) => (
                                                    <a
                                                        key={lead.id}
                                                        href={lead.kommoUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="alert-row glass"
                                                    >
                                                        <span className="alert-lead-name">{lead.nome}</span>
                                                        <span className="alert-meta">{lead.vendedor}</span>
                                                        <span className="alert-badge red">{lead.diasSemAtividade}d</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}

                                        {activity.leadsEmRisco7d.length > 0 && (
                                            <div className="alert-section alert-yellow">
                                                <div className="alert-section-header">
                                                    <Clock size={16} />
                                                    <span>Em risco (sem atividade +7d) — {activity.leadsEmRisco7d.length} lead{activity.leadsEmRisco7d.length !== 1 ? 's' : ''}</span>
                                                </div>
                                                {activity.leadsEmRisco7d.map((lead) => (
                                                    <a
                                                        key={lead.id}
                                                        href={lead.kommoUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="alert-row glass"
                                                    >
                                                        <span className="alert-lead-name">{lead.nome}</span>
                                                        <span className="alert-meta">{lead.vendedor}</span>
                                                        <span className="alert-badge yellow">{lead.diasSemAtividade}d</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}

                                        {activity.tarefasVencidas.length > 0 && (
                                            <div className="alert-section alert-orange">
                                                <div className="alert-section-header">
                                                    <XCircle size={16} />
                                                    <span>Tarefas vencidas — {activity.tarefasVencidas.length}</span>
                                                </div>
                                                {activity.tarefasVencidas.map((task) => (
                                                    <a
                                                        key={task.id}
                                                        href={task.kommoUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="alert-row glass"
                                                    >
                                                        <span className="alert-lead-name">{task.leadNome}</span>
                                                        <span className="alert-meta">{task.vendedor} · {task.texto}</span>
                                                        <span className="alert-badge orange">{task.diasVencida}d</span>
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            );
        }
```

**Step 4: Add "Painel de Alertas" sidebar button**

Find lines 724–730 in `App.tsx`:
```tsx
                        <button
                            className={activeTab === 'agents' && page !== 'admin' ? 'active' : ''}
                            onClick={() => { setPage('app'); loadTabData('agents'); }}
                        >
                            <BarChart3 size={18} /> Relatório Agentes
                        </button>
```

Insert this block immediately BEFORE those lines (between Resumo Geral and Relatório Agentes):

```tsx
                        <button
                            className={activeTab === 'alerts' && page !== 'admin' ? 'active' : ''}
                            onClick={() => { setPage('app'); loadTabData('alerts'); }}
                        >
                            <AlertTriangle size={18} /> Painel de Alertas
                        </button>
```

**Step 5: Reset `alerts` tab state on logout**

In `handleLogout` (around line 204), add alongside the other state resets:

```typescript
        setMessages([{ role: 'assistant', content: 'Olá! Sou o assistente inteligente do Kommo CRM. Tenho acesso aos dados reais dos seus funis — leads, conversões, agentes e muito mais. O que deseja saber?' }]);
```

The line after `setExpandedTeams(new Set());` should have no change needed for alerts since `setTabData(null)` already handles it. No extra reset required.

**Step 6: Add CSS for alerts panel at the end of `web/src/index.css`**

Append to the very end of `web/src/index.css`:

```css
/* ── Painel de Alertas ────────────────────────────── */
.alerts-content {
  padding: 24px;
}
.alerts-all-clear {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px;
  margin: 24px;
  border-radius: 12px;
  color: #4ade80;
}
.alerts-all-clear p {
  font-size: 1rem;
  color: #94a3b8;
}
.alerts-team-section {
  margin-bottom: 32px;
}
.alerts-team-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}
.alerts-team-title.azul   { color: #60a5fa; }
.alerts-team-title.amarela { color: #fbbf24; }

.alert-section {
  margin-bottom: 20px;
  border-radius: 10px;
  overflow: hidden;
}
.alert-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.alert-red  .alert-section-header { background: rgba(239,68,68,0.15); color: #f87171; }
.alert-yellow .alert-section-header { background: rgba(234,179,8,0.15); color: #facc15; }
.alert-orange .alert-section-header { background: rgba(249,115,22,0.15); color: #fb923c; }

.alert-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  text-decoration: none;
  color: inherit;
  border-top: 1px solid rgba(255,255,255,0.05);
  transition: background 0.15s;
}
.alert-row:hover { background: rgba(255,255,255,0.04); }

.alert-lead-name {
  flex: 1;
  font-size: 0.85rem;
  font-weight: 500;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.alert-meta {
  font-size: 0.75rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.alert-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
  white-space: nowrap;
}
.alert-badge.red    { background: rgba(239,68,68,0.2);  color: #f87171; }
.alert-badge.yellow { background: rgba(234,179,8,0.2);  color: #facc15; }
.alert-badge.orange { background: rgba(249,115,22,0.2); color: #fb923c; }
```

**Step 7: Build**

```bash
cd /Users/guicrasto/antigravity-gui/kommo-mcp-agent && npm run build:all 2>&1 | tail -20
```
Expected: zero TypeScript errors, Vite build succeeds.

**Step 8: Commit**

```bash
git add web/src/App.tsx web/src/index.css
git commit -m "feat: add Painel de Alertas tab with clickable lead links"
```

---

### Task 6: Push and verify on Railway

**Step 1: Push**

```bash
git push origin main
```

**Step 2: After Railway redeploys, verify the activity endpoint**

```bash
# Replace TOKEN with a valid auth token from localStorage
curl -s "https://<railway-url>/api/reports/activity" \
  -H "Authorization: Bearer TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for team in d:
    print(f\"Team: {team['team']} | Abandonados48h: {len(team['activity']['leadsAbandonados48h'])} | Risco7d: {len(team['activity']['leadsEmRisco7d'])} | TarefasVencidas: {len(team['activity']['tarefasVencidas'])}\")
"
```
Expected: one line per team with counts.

**Step 3: Verify in the browser**

- Sidebar: "Painel de Alertas" button appears between Resumo Geral and Relatório Agentes
- Clicking it loads alert cards grouped by team
- Each lead row is clickable and opens `https://{subdomain}.kommo.com/leads/detail/{id}` in a new tab
- Chat: ask "quem está com leads abandonados?" and verify the assistant references the ALERTAS DE ATIVIDADE data
