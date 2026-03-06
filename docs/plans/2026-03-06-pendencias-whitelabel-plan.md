# SuperGerente — Pendencias + White Label Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 5 backend/frontend features (tag filter, pipeline visibility, auth funnel permissions, SSE dashboard, Supabase migration) + white-label setup script.

**Architecture:** Backend-first approach. Each feature modifies the Express API layer (reports.ts, requireAuth.ts) and the CRM cache filtering. Frontend changes update stores, hooks, and components. No database schema changes except running existing migration SQL.

**Tech Stack:** TypeScript, Express, Supabase, React 18, Zustand, Vite, Tailwind CSS v4

---

## Task 1: Run Supabase migration `user_funnel_permissions`

**Files:**
- Reference: `docs/migrations/user_funnel_permissions.sql`

**Step 1: Run the migration via Supabase dashboard or CLI**

The SQL to execute:

```sql
CREATE TABLE IF NOT EXISTS user_funnel_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team TEXT NOT NULL CHECK (team IN ('azul', 'amarela')),
  allowed_funnels JSONB NOT NULL DEFAULT '[]',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, team)
);

ALTER TABLE user_funnel_permissions ENABLE ROW LEVEL SECURITY;
```

**Step 2: Verify table exists**

Run in Supabase SQL editor:
```sql
SELECT * FROM user_funnel_permissions LIMIT 1;
```
Expected: empty result set, no error.

**Step 3: Commit** (nothing to commit — migration is external)

---

## Task 2: Backend — Auth middleware adds `allowedFunnels` + `pausedPipelines`

**Files:**
- Modify: `src/api/middleware/requireAuth.ts`

**Step 1: Update AuthRequest interface and CachedProfile**

Add `allowedFunnels` and `pausedPipelines` to `AuthRequest` and cache:

```typescript
// In AuthRequest interface (line 10-14), add:
export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userTeams?: TeamKey[];
  allowedFunnels?: Record<TeamKey, number[]>;  // NEW
  pausedPipelines?: number[];                   // NEW
}

// In CachedProfile interface (line 17-22), add:
interface CachedProfile {
  userId: string;
  role: string;
  teams: TeamKey[];
  allowedFunnels: Record<TeamKey, number[]>;  // NEW
  pausedPipelines: number[];                   // NEW
  expiresAt: number;
}
```

**Step 2: Fetch `user_funnel_permissions` + `paused_pipelines` in requireAuth**

After fetching the profile (line 62-66), add two parallel queries:

```typescript
  // After the profile fetch block, before the teams assignment:

  // Fetch funnel permissions + paused pipelines in parallel
  const [permissionsResult, pausedResult] = await Promise.all([
    supabase
      .from("user_funnel_permissions")
      .select("team, allowed_funnels")
      .eq("user_id", user.id),
    supabase
      .from("settings")
      .select("value")
      .eq("key", "paused_pipelines")
      .single(),
  ]);

  const allowedFunnels: Record<TeamKey, number[]> = { azul: [], amarela: [] };
  if (permissionsResult.data) {
    for (const row of permissionsResult.data) {
      const team = row.team as TeamKey;
      const funnels = Array.isArray(row.allowed_funnels) ? row.allowed_funnels : [];
      allowedFunnels[team] = funnels;
    }
  }

  let pausedPipelines: number[] = [];
  if (pausedResult.data?.value) {
    try {
      pausedPipelines = Array.isArray(pausedResult.data.value)
        ? pausedResult.data.value
        : JSON.parse(pausedResult.data.value);
    } catch {
      pausedPipelines = [];
    }
  }
```

**Step 3: Set on request and cache**

Update the cache set and req assignments (lines 78-89):

```typescript
  authCache.set(token, {
    userId: user.id,
    role: profile.role,
    teams,
    allowedFunnels,       // NEW
    pausedPipelines,      // NEW
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
  });

  req.userId = user.id;
  req.userRole = profile.role;
  req.userTeams = teams;
  req.allowedFunnels = allowedFunnels;      // NEW
  req.pausedPipelines = pausedPipelines;    // NEW
  next();
```

Also update the cache-hit path (lines 48-53):

```typescript
  if (cached && Date.now() < cached.expiresAt) {
    req.userId = cached.userId;
    req.userRole = cached.role;
    req.userTeams = cached.teams;
    req.allowedFunnels = cached.allowedFunnels;      // NEW
    req.pausedPipelines = cached.pausedPipelines;    // NEW
    return next();
  }
```

**Step 4: Verify build**

Run: `cd /Users/guicrasto/supergerente && npx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add src/api/middleware/requireAuth.ts
git commit -m "feat: auth middleware loads allowedFunnels + pausedPipelines"
```

---

## Task 3: Backend — Helper function to filter CrmMetrics by tags, funnels, paused pipelines

**Files:**
- Create: `src/api/helpers/filter-metrics.ts`

**Step 1: Create the filter helper**

```typescript
import { CrmMetrics, LeadSnapshot, VendedorMetrics, FunilMetrics, LeadTag } from "../cache/crm-cache.js";
import { TeamKey } from "../../config.js";

interface FilterOptions {
  tags?: number[];
  tagMode?: "or" | "and";
  allowedFunnels?: number[];   // empty = all allowed
  pausedPipelines?: number[];  // pipelines to exclude
  isAdmin?: boolean;
}

export function filterCrmMetrics(metrics: CrmMetrics, opts: FilterOptions): CrmMetrics {
  const { tags, tagMode = "or", allowedFunnels = [], pausedPipelines = [], isAdmin = false } = opts;

  // Step 1: Filter funis by allowedFunnels + pausedPipelines
  let filteredFunis: Record<string, FunilMetrics> = {};
  for (const [key, funil] of Object.entries(metrics.funis)) {
    const pipelineId = Number(key);

    // Paused pipelines: hide from non-admins
    if (!isAdmin && pausedPipelines.includes(pipelineId)) continue;

    // Allowed funnels: if non-empty, only show those
    if (allowedFunnels.length > 0 && !allowedFunnels.includes(pipelineId)) continue;

    filteredFunis[key] = funil;
  }

  const allowedPipelineIds = new Set(Object.keys(filteredFunis).map(Number));

  // Step 2: Filter leadSnapshots by allowed pipelines
  let filteredSnapshots = metrics.leadSnapshots.filter(
    (l) => allowedPipelineIds.has(l.pipeline_id)
  );

  // Step 3: Filter by tags (if provided)
  if (tags && tags.length > 0) {
    filteredSnapshots = filteredSnapshots.filter((lead) => {
      const leadTagIds = lead.tags.map((t) => t.id);
      if (tagMode === "and") {
        return tags.every((tagId) => leadTagIds.includes(tagId));
      }
      // OR mode
      return tags.some((tagId) => leadTagIds.includes(tagId));
    });
  }

  // Step 4: Filter vendedores by allowed pipelines
  const filteredVendedores = metrics.vendedores.filter((v) => {
    // vendedores have funil name, need to check if any of their pipelines are allowed
    return Object.values(filteredFunis).some((f) => f.nome === v.funil);
  });

  // Step 5: Filter activeLeads by allowed pipelines
  // activeLeads don't have pipeline_id, so we need to cross-reference with snapshots
  const allowedLeadIds = new Set(filteredSnapshots.map((s) => s.id));
  const filteredActiveLeads = metrics.activeLeads.filter((l) => allowedLeadIds.has(l.id));

  // Step 6: Recalculate geral from filtered data
  const STATUS_WON = 142;
  const STATUS_LOST = 143;

  const totalGanhos = filteredSnapshots.filter((l) => l.status_id === STATUS_WON).length;
  const totalPerdidos = filteredSnapshots.filter((l) => l.status_id === STATUS_LOST).length;
  const totalAtivos = filteredSnapshots.length - totalGanhos - totalPerdidos;
  const convBase = totalGanhos + totalPerdidos;

  function countPeriod(leads: LeadSnapshot[], days: number): number {
    const cutoff = Date.now() / 1000 - days * 86400;
    return leads.filter((l) => l.created_at >= cutoff).length;
  }

  const geral = {
    total: filteredSnapshots.length,
    ganhos: totalGanhos,
    perdidos: totalPerdidos,
    ativos: totalAtivos,
    conversao: convBase > 0 ? ((totalGanhos / convBase) * 100).toFixed(1) + "%" : "0.0%",
    novosHoje: countPeriod(filteredSnapshots, 1),
    novosSemana: countPeriod(filteredSnapshots, 7),
    novosMes: countPeriod(filteredSnapshots, 30),
  };

  // Step 7: Collect tags from filtered snapshots
  const tagMap = new Map<number, string>();
  for (const snap of filteredSnapshots) {
    for (const t of snap.tags) {
      if (!tagMap.has(t.id)) tagMap.set(t.id, t.name);
    }
  }
  const allTags: LeadTag[] = Array.from(tagMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    funis: filteredFunis,
    vendedores: filteredVendedores,
    geral,
    activeLeads: filteredActiveLeads,
    leadSnapshots: filteredSnapshots,
    pipelineNames: Object.fromEntries(
      Object.entries(metrics.pipelineNames).filter(([id]) => allowedPipelineIds.has(Number(id)))
    ),
    userNames: metrics.userNames,
    allTags,
    atualizadoEm: metrics.atualizadoEm,
  };
}

/** Parse tags and tagMode from Express query */
export function parseTagsFromQuery(query: any): { tags: number[]; tagMode: "or" | "and" } {
  let tags: number[] = [];
  if (typeof query.tags === "string" && query.tags.length > 0) {
    tags = query.tags.split(",").map(Number).filter((n: number) => !isNaN(n) && n > 0);
  }
  const tagMode = query.tagMode === "and" ? "and" : "or";
  return { tags, tagMode };
}
```

**Step 2: Verify build**

Run: `cd /Users/guicrasto/supergerente && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/api/helpers/filter-metrics.ts
git commit -m "feat: add filter-metrics helper for tags, funnels, paused pipelines"
```

---

## Task 4: Backend — Apply filters to ALL report endpoints

**Files:**
- Modify: `src/api/routes/reports.ts`

**Step 1: Import the filter helper**

At the top of `reports.ts` (after line 6), add:

```typescript
import { filterCrmMetrics, parseTagsFromQuery } from "../helpers/filter-metrics.js";
```

**Step 2: Create a helper to get filtered metrics per request**

After the `getCustomFieldValue` function (after line 32), add:

```typescript
  /** Get CRM metrics filtered by user permissions + query params */
  async function getFilteredMetrics(req: AuthRequest) {
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    const results = await Promise.all(
      userTeams.filter((t) => !!services[t]).map(async (team) => {
        const raw = await getCrmMetrics(team, services[team]);
        const filtered = filterCrmMetrics(raw, {
          tags,
          tagMode,
          allowedFunnels: allowedFunnels[team] || [],
          pausedPipelines,
          isAdmin,
        });
        return { team, metrics: filtered };
      })
    );

    return results;
  }
```

**Step 3: Refactor each endpoint to use `getFilteredMetrics`**

Replace the `allMetrics` pattern in each endpoint. Every endpoint that currently does:

```typescript
const allMetrics = await Promise.all(
  userTeams.filter((t) => !!services[t]).map(async (team) => ({
    team,
    metrics: await getCrmMetrics(team, services[team]),
  }))
);
```

Replace with:

```typescript
const allMetrics = await getFilteredMetrics(req);
```

Apply this to endpoints: `/agents`, `/summary`, `/dashboard`, `/activity`, `/daily`, `/tags`, `/tmf`, `/loss-reasons`, `/income`, `/profession`.

For `/activity` endpoint specifically, the `getCrmMetrics` call inside the map needs to use the filtered version too:

```typescript
  router.get("/activity", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const { tags, tagMode } = parseTagsFromQuery(req.query);
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    try {
      const result: Array<{ team: TeamKey; label: string; activity: ActivityMetrics }> = [];

      const activityResults = await Promise.all(
        userTeams.filter((t) => !!services[t]).map(async (team) => {
          try {
            const raw = await getCrmMetrics(team, services[team]);
            const filtered = filterCrmMetrics(raw, {
              tags, tagMode,
              allowedFunnels: allowedFunnels[team] || [],
              pausedPipelines, isAdmin,
            });
            const activity = await getActivityMetrics(team, services[team], filtered);
            return { team, label: team === "azul" ? "Equipe Azul" : "Equipe Amarela", activity };
          } catch (teamErr: any) {
            console.error(`[/api/reports/activity] Erro na equipe ${team}:`, teamErr.message);
            return null;
          }
        })
      );
      for (const r of activityResults) {
        if (r) result.push(r);
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
```

**Step 4: Verify build**

Run: `cd /Users/guicrasto/supergerente && npx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add src/api/routes/reports.ts
git commit -m "feat: apply tag/funnel/pipeline filters to all report endpoints"
```

---

## Task 5: Backend — Expand SSE stream to send full dashboard data

**Files:**
- Modify: `src/api/routes/reports.ts` (SSE `/stream` endpoint, line 655-692)

**Step 1: Replace the SSE `sendUpdate` function**

Replace the current `/stream` handler with one that sends summary, dashboard agents, and activity data:

```typescript
  router.get("/stream", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    const allowedFunnels = req.allowedFunnels || { azul: [], amarela: [] };
    const pausedPipelines = req.pausedPipelines || [];
    const isAdmin = req.userRole === "admin";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendUpdate = async () => {
      try {
        const teamsData = await Promise.all(
          userTeams.filter((t) => !!services[t]).map(async (team) => {
            const raw = await getCrmMetrics(team, services[team]);
            const metrics = filterCrmMetrics(raw, {
              tags: [],
              tagMode: "or",
              allowedFunnels: allowedFunnels[team] || [],
              pausedPipelines,
              isAdmin,
            });

            // Summary: funis list
            const summary = Object.values(metrics.funis).map((f) => ({
              nome: f.nome,
              team,
              novosHoje: f.novosHoje,
              novosMes: f.novosMes,
              ativos: f.ativos,
            }));

            // Dashboard agents aggregated
            const byAgent: Record<string, {
              nome: string; total: number; ganhos: number;
              ganhosHoje: number; ganhosSemana: number; ativos: number;
            }> = {};
            for (const v of metrics.vendedores) {
              if (!byAgent[v.nome]) {
                byAgent[v.nome] = { nome: v.nome, total: 0, ganhos: 0, ganhosHoje: 0, ganhosSemana: 0, ativos: 0 };
              }
              byAgent[v.nome].total += v.total;
              byAgent[v.nome].ganhos += v.ganhos;
              byAgent[v.nome].ganhosHoje += v.ganhosHoje;
              byAgent[v.nome].ganhosSemana += v.ganhosSemana;
              byAgent[v.nome].ativos += v.ativos;
            }
            const agents = Object.values(byAgent).sort((a, b) => b.total - a.total);

            // Activity (lightweight — pass filtered metrics to avoid re-fetch)
            let activity = null;
            try {
              activity = await getActivityMetrics(team, services[team], metrics);
            } catch {}

            return {
              team,
              geral: metrics.geral,
              summary,
              agents,
              activity,
              atualizadoEm: new Date().toISOString(),
            };
          })
        );
        const payload = JSON.stringify({ teams: teamsData });
        res.write(`data: ${payload}\n\n`);
      } catch (err: any) {
        console.error("[SSE /stream] Erro ao enviar update:", err.message);
      }
    };

    await sendUpdate();
    const interval = setInterval(sendUpdate, 30_000);
    req.on("close", () => { clearInterval(interval); });
  });
```

**Step 2: Verify build**

Run: `cd /Users/guicrasto/supergerente && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/api/routes/reports.ts
git commit -m "feat: SSE stream sends full dashboard data (summary + agents + activity)"
```

---

## Task 6: Frontend — Add `tagMode` to filterStore

**Files:**
- Modify: `web/src/stores/filterStore.ts`

**Step 1: Add `tagMode` state and setter**

Add to the `FilterState` interface (after line 14 `selectedTags`):

```typescript
  tagMode: 'or' | 'and';
  setTagMode: (mode: 'or' | 'and') => void;
```

Add to the create function (after line 44 `selectedTags: []`):

```typescript
  tagMode: 'or',
  setTagMode: (tagMode) => set({ tagMode }),
```

**Step 2: Verify build**

Run: `cd /Users/guicrasto/supergerente/web && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add web/src/stores/filterStore.ts
git commit -m "feat: add tagMode (or/and) to filterStore"
```

---

## Task 7: Frontend — Add AND/OR toggle to TagFilter

**Files:**
- Modify: `web/src/components/features/filters/TagFilter.tsx`

**Step 1: Import tagMode from store and add toggle**

Add to the store imports (after line 17):

```typescript
  const tagMode = useFilterStore((s) => s.tagMode);
  const setTagMode = useFilterStore((s) => s.setTagMode);
```

Add toggle button inside the dropdown, before the tag list (after the "Limpar filtro" button, around line 70):

```tsx
          {/* AND/OR toggle */}
          {selectedTags.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-glass-border">
              <span className="text-body-sm text-muted mr-1">Modo:</span>
              <button
                onClick={() => setTagMode('or')}
                className={cn(
                  'px-2 py-0.5 rounded text-body-sm font-medium transition-colors cursor-pointer',
                  tagMode === 'or'
                    ? 'bg-primary text-white'
                    : 'bg-surface-secondary text-muted hover:text-foreground'
                )}
              >
                Qualquer
              </button>
              <button
                onClick={() => setTagMode('and')}
                className={cn(
                  'px-2 py-0.5 rounded text-body-sm font-medium transition-colors cursor-pointer',
                  tagMode === 'and'
                    ? 'bg-primary text-white'
                    : 'bg-surface-secondary text-muted hover:text-foreground'
                )}
              >
                Todas
              </button>
            </div>
          )}
```

**Step 2: Verify build**

Run: `cd /Users/guicrasto/supergerente/web && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add web/src/components/features/filters/TagFilter.tsx
git commit -m "feat: add AND/OR toggle to TagFilter dropdown"
```

---

## Task 8: Frontend — Pass tags to API calls

**Files:**
- Modify: `web/src/lib/api.ts` or wherever api calls are made

The approach: create a helper that appends tag query params, then use it in DashboardPage (and other pages that call reports).

**Step 1: Create query param helper**

In `web/src/lib/utils.ts` (or create `web/src/lib/query-params.ts`), add:

```typescript
export function buildTagParams(selectedTags: number[], tagMode: 'or' | 'and'): string {
  if (selectedTags.length === 0) return '';
  const params = new URLSearchParams();
  params.set('tags', selectedTags.join(','));
  if (tagMode === 'and') params.set('tagMode', 'and');
  return '?' + params.toString();
}
```

**Step 2: Update DashboardPage to pass tags in API calls**

In `web/src/pages/DashboardPage.tsx`, import and use:

```typescript
import { buildTagParams } from '@/lib/utils';

// Inside DashboardPage component, read tags from store:
const selectedTags = useFilterStore((s) => s.selectedTags);
const tagMode = useFilterStore((s) => s.tagMode);

// Update fetchData to include tags:
const fetchData = useCallback(async (isBackground = false) => {
  try {
    if (!isBackground) setLoading(true);
    const tagQuery = buildTagParams(selectedTags, tagMode);
    const [summaryRes, activityRes, dashboardRes] = await Promise.all([
      api.get<SummaryItem[]>(`/reports/summary${tagQuery}`),
      api.get<ActivityTeam[]>(`/reports/activity${tagQuery}`),
      api.get<DashboardData>(`/reports/dashboard${tagQuery}`),
    ]);
    setSummary(summaryRes.data);
    setActivity(activityRes.data);
    setDashboard(dashboardRes.data);
    setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  } catch (err) {
    console.error('[DashboardPage] Erro ao carregar dados:', err);
  } finally {
    setLoading(false);
  }
}, [selectedTags, tagMode]);  // Re-fetch when tags change
```

**Step 3: Verify build**

Run: `cd /Users/guicrasto/supergerente/web && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add web/src/lib/utils.ts web/src/pages/DashboardPage.tsx
git commit -m "feat: pass tags + tagMode to report API calls"
```

---

## Task 9: Frontend — Replace polling with SSE on DashboardPage

**Files:**
- Modify: `web/src/hooks/useSSE.ts`
- Modify: `web/src/pages/DashboardPage.tsx`

**Step 1: Update SSE payload types in useSSE.ts**

Replace the interfaces to match the expanded SSE data:

```typescript
interface SSESummaryItem {
  nome: string;
  team: string;
  novosHoje: number;
  novosMes: number;
  ativos: number;
}

interface SSEAgent {
  nome: string;
  total: number;
  ganhos: number;
  ganhosHoje: number;
  ganhosSemana: number;
  ativos: number;
}

interface SSEActivity {
  leadsAbandonados48h: Array<{
    id: number; nome: string; vendedor: string;
    diasSemAtividade: number; kommoUrl: string;
  }>;
  leadsEmRisco7d: Array<{
    id: number; nome: string; vendedor: string;
    diasSemAtividade: number; kommoUrl: string;
  }>;
  tarefasVencidas: Array<{
    id: number; texto: string; vendedor: string;
    leadId: number; leadNome: string; diasVencida: number; kommoUrl: string;
  }>;
}

interface SSETeamData {
  team: string;
  geral: {
    total: number; ganhos: number; perdidos: number;
    ativos: number; conversao: string;
    novosHoje: number; novosSemana: number; novosMes: number;
  };
  summary: SSESummaryItem[];
  agents: SSEAgent[];
  activity: SSEActivity | null;
  atualizadoEm: string;
}

export interface SSEPayload {
  teams: SSETeamData[];
}
```

**Step 2: Update DashboardPage to use SSE as primary data source**

In `DashboardPage.tsx`:

1. Import `useSSE`:
```typescript
import { useSSE } from '@/hooks/useSSE';
```

2. Inside the component, add SSE hook and derive data from it:
```typescript
  const { data: sseData, connected: sseConnected } = useSSE();

  // SSE provides real-time data — use it when available
  useEffect(() => {
    if (!sseData) return;

    // Derive summary from SSE
    const sseSummary: SummaryItem[] = sseData.teams.flatMap((t) => t.summary || []);
    setSummary(sseSummary);

    // Derive dashboard from SSE
    const agentsByTeam: Record<string, DashboardAgent[]> = {};
    for (const t of sseData.teams) {
      agentsByTeam[t.team] = t.agents || [];
    }
    setDashboard({ agentsByTeam });

    // Derive activity from SSE
    const activityData: ActivityTeam[] = sseData.teams
      .filter((t) => t.activity)
      .map((t) => ({
        team: t.team,
        label: t.team === 'azul' ? 'Equipe Azul' : 'Equipe Amarela',
        activity: t.activity!,
      }));
    setActivity(activityData);

    setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setLoading(false);
  }, [sseData]);
```

3. Keep the HTTP fetch as fallback — only poll if SSE is not connected:

```typescript
  useEffect(() => {
    // Initial fetch (SSE takes a moment to connect)
    fetchData();

    // Only poll if SSE is not connected (fallback)
    if (!sseConnected) {
      const interval = setInterval(() => fetchData(true), REFRESH_INTERVAL_MS);
      return () => clearInterval(interval);
    }
  }, [fetchData, sseConnected]);
```

**Step 3: Verify build**

Run: `cd /Users/guicrasto/supergerente/web && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add web/src/hooks/useSSE.ts web/src/pages/DashboardPage.tsx
git commit -m "feat: dashboard uses SSE for real-time updates, HTTP polling as fallback"
```

---

## Task 10: Frontend — Rename "Pausar" to "Ocultar dos relatórios" in AdminPage

**Files:**
- Modify: `web/src/pages/AdminPage.tsx`

**Step 1: Find and replace labels**

Search for "Pausar" / "Pausado" / "Reativar" / "pausar" in AdminPage.tsx and replace:

- "Pausar" → "Ocultar"
- "Pausado" → "Oculto"
- "Reativar" → "Mostrar"
- "Pipeline pausado" → "Pipeline oculto dos relatórios"
- Any tooltip/description about pausing → update to mention "ocultar dos relatórios dos usuários"

**Step 2: Verify build**

Run: `cd /Users/guicrasto/supergerente/web && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add web/src/pages/AdminPage.tsx
git commit -m "feat: rename 'Pausar' to 'Ocultar dos relatórios' in admin"
```

---

## Task 11: White Label — Setup script

**Files:**
- Create: `scripts/setup-whitelabel.sh`

**Step 1: Create the interactive setup script**

```bash
#!/bin/bash
set -e

echo "============================================"
echo "  SuperGerente — White Label Setup"
echo "============================================"
echo ""

# 1. Collect info
read -p "Nome da marca (ex: MeuCRM): " BRAND_NAME
read -p "Descrição curta: " BRAND_DESC
read -p "Cor tema (hex, ex: #2563EB): " THEME_COLOR
read -p "Subdomínio Kommo (equipe principal): " KOMMO_SUB
read -p "Kommo Client ID: " KOMMO_CID
read -p "Kommo Client Secret: " KOMMO_CS
read -p "Kommo Redirect URI: " KOMMO_REDIR
read -p "Kommo Access Token: " KOMMO_TOKEN
read -p "Supabase URL: " SUPA_URL
read -p "Supabase Service Key: " SUPA_KEY
read -p "Gemini API Key: " GEMINI_KEY
read -p "Porta (default 3000): " PORT
PORT=${PORT:-3000}

# Optional second team
read -p "Tem equipe secundária (amarela)? (s/n): " HAS_AMARELA
if [[ "$HAS_AMARELA" == "s" ]]; then
  read -p "Subdomínio Kommo (amarela): " KOMMO_AM_SUB
  read -p "Kommo Client ID (amarela): " KOMMO_AM_CID
  read -p "Kommo Client Secret (amarela): " KOMMO_AM_CS
  read -p "Kommo Redirect URI (amarela): " KOMMO_AM_REDIR
  read -p "Kommo Access Token (amarela): " KOMMO_AM_TOKEN
fi

# 2. Generate .env
echo ""
echo "Gerando .env..."
cat > .env << ENVEOF
# Branding
VITE_APP_NAME=${BRAND_NAME}
VITE_APP_SHORT_NAME=${BRAND_NAME}
VITE_APP_DESCRIPTION=${BRAND_DESC}
VITE_APP_THEME_COLOR=${THEME_COLOR}

# Kommo — Equipe Azul (principal)
KOMMO_SUBDOMAIN=${KOMMO_SUB}
KOMMO_CLIENT_ID=${KOMMO_CID}
KOMMO_CLIENT_SECRET=${KOMMO_CS}
KOMMO_REDIRECT_URI=${KOMMO_REDIR}
KOMMO_ACCESS_TOKEN=${KOMMO_TOKEN}

# Kommo — Equipe Amarela (opcional)
KOMMO_AMARELA_SUBDOMAIN=${KOMMO_AM_SUB:-}
KOMMO_AMARELA_CLIENT_ID=${KOMMO_AM_CID:-}
KOMMO_AMARELA_CLIENT_SECRET=${KOMMO_AM_CS:-}
KOMMO_AMARELA_REDIRECT_URI=${KOMMO_AM_REDIR:-}
KOMMO_AMARELA_ACCESS_TOKEN=${KOMMO_AM_TOKEN:-}

# IA
GEMINI_API_KEY=${GEMINI_KEY}

# Database
SUPABASE_URL=${SUPA_URL}
SUPABASE_SERVICE_KEY=${SUPA_KEY}

# Server
PORT=${PORT}
ENVEOF

echo "✅ .env gerado"

# 3. Install dependencies
echo ""
echo "Instalando dependências..."
npm install
npm install --prefix web

echo "✅ Dependências instaladas"

# 4. Run Supabase migrations
echo ""
echo "Rodando migrações Supabase..."
echo "⚠️  Execute os SQLs em docs/migrations/ no painel do Supabase:"
echo "   - docs/migrations/001-mentors.sql"
echo "   - docs/migrations/user_funnel_permissions.sql"
echo ""
read -p "Pressione Enter quando as migrações estiverem rodadas..."

# 5. Build
echo ""
echo "Fazendo build..."
npm run build

echo "✅ Build concluído"

# 6. Summary
echo ""
echo "============================================"
echo "  Setup concluído!"
echo "============================================"
echo ""
echo "Para rodar localmente:"
echo "  npm start"
echo ""
echo "Para deploy no Railway:"
echo "  railway login"
echo "  railway up"
echo ""
echo "Para criar admin:"
echo "  1. Registre no app"
echo "  2. No Supabase, altere role para 'admin' e status para 'approved'"
echo ""
```

**Step 2: Make executable**

```bash
chmod +x scripts/setup-whitelabel.sh
```

**Step 3: Commit**

```bash
git add scripts/setup-whitelabel.sh
git commit -m "feat: add interactive white-label setup script"
```

---

## Summary of All Tasks

| # | Task | Files | Type |
|---|------|-------|------|
| 1 | Supabase migration | SQL only | Infra |
| 2 | Auth middleware + allowedFunnels + pausedPipelines | `requireAuth.ts` | Backend |
| 3 | Filter helper function | `filter-metrics.ts` (new) | Backend |
| 4 | Apply filters to all report endpoints | `reports.ts` | Backend |
| 5 | Expand SSE stream | `reports.ts` | Backend |
| 6 | Add `tagMode` to filterStore | `filterStore.ts` | Frontend |
| 7 | AND/OR toggle in TagFilter | `TagFilter.tsx` | Frontend |
| 8 | Pass tags to API calls | `utils.ts`, `DashboardPage.tsx` | Frontend |
| 9 | SSE replaces polling on Dashboard | `useSSE.ts`, `DashboardPage.tsx` | Frontend |
| 10 | Rename "Pausar" → "Ocultar" in admin | `AdminPage.tsx` | Frontend |
| 11 | White-label setup script | `setup-whitelabel.sh` (new) | Tooling |
