# Multi-Team (Equipe Azul / Equipe Amarela) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two-team support (Equipe Azul = ferramentasempresa001, Equipe Amarela = iadeoperacoes) with per-user access control and unified UI.

**Architecture:** Two hardcoded KommoService instances, two separate CRM caches, `teams text[]` column in `profiles`, routes filter by user's authorized teams. Pipelines discovered dynamically (no hardcoded IDs).

**Tech Stack:** Express + TypeScript + Supabase + React + Vite

---

## Pre-requisite: Run SQL in Supabase

Before coding, run this in Supabase SQL Editor:

```sql
-- 1. Add teams column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS teams text[] DEFAULT '{}';

-- 2. Give existing admin access to both teams
UPDATE public.profiles SET teams = '{"azul","amarela"}' WHERE role = 'admin';

-- 3. Add Equipe Amarela token rows
INSERT INTO public.settings (key, value) VALUES
  ('kommo_amarela_access_token', ''),
  ('kommo_amarela_refresh_token', '')
ON CONFLICT (key) DO NOTHING;

-- 4. Migrate existing tokens to team-scoped keys
INSERT INTO public.settings (key, value, updated_at)
SELECT 'kommo_azul_access_token', value, updated_at
FROM public.settings WHERE key = 'kommo_access_token'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

INSERT INTO public.settings (key, value, updated_at)
SELECT 'kommo_azul_refresh_token', value, updated_at
FROM public.settings WHERE key = 'kommo_refresh_token'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
```

Also add these env vars in Railway (Variables tab):
```
KOMMO_AMARELA_SUBDOMAIN=iadeoperacoes
KOMMO_AMARELA_CLIENT_ID=23bd9614-85d2-45fa-9adf-42e4ef25048b
KOMMO_AMARELA_CLIENT_SECRET=7Pz8zJ7oUGtWsfDOTbfoStu9MZXAFiiKgar4XXggl6PFt2O5SHoAv9PqAyTtZfd6
KOMMO_AMARELA_REDIRECT_URI=https://example.com
```

---

### Task 1: Update config.ts — add team configs

**Files:**
- Modify: `src/config.ts` (full rewrite)

**Step 1: Replace `src/config.ts` with:**

```typescript
import dotenv from "dotenv";
dotenv.config();

export type TeamKey = "azul" | "amarela";

export interface TeamConfig {
  label: string;
  subdomain: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  excludePipelineNames: string[]; // case-insensitive substrings to exclude
}

export const TEAMS: Record<TeamKey, TeamConfig> = {
  azul: {
    label: "Equipe Azul",
    subdomain: process.env.KOMMO_SUBDOMAIN || "",
    clientId: process.env.KOMMO_CLIENT_ID || "",
    clientSecret: process.env.KOMMO_CLIENT_SECRET || "",
    redirectUri: process.env.KOMMO_REDIRECT_URI || "",
    accessToken: process.env.KOMMO_ACCESS_TOKEN || "",
    excludePipelineNames: [],
  },
  amarela: {
    label: "Equipe Amarela",
    subdomain: process.env.KOMMO_AMARELA_SUBDOMAIN || "",
    clientId: process.env.KOMMO_AMARELA_CLIENT_ID || "",
    clientSecret: process.env.KOMMO_AMARELA_CLIENT_SECRET || "",
    redirectUri: process.env.KOMMO_AMARELA_REDIRECT_URI || "",
    accessToken: process.env.KOMMO_AMARELA_ACCESS_TOKEN || "",
    excludePipelineNames: ["funil teste"],
  },
};

// Legacy: kommoConfig still used by oauth.ts — keep for now (will be updated in Task 7)
export const kommoConfig = {
  subdomain: TEAMS.azul.subdomain,
  clientId: TEAMS.azul.clientId,
  clientSecret: TEAMS.azul.clientSecret,
  redirectUri: TEAMS.azul.redirectUri,
  accessToken: TEAMS.azul.accessToken,
};

export const PORT = parseInt(process.env.PORT || "3000", 10);

export function validateConfig() {
  if (!TEAMS.azul.subdomain) {
    console.error("Erro: KOMMO_SUBDOMAIN é obrigatório no .env");
    process.exit(1);
  }
  if (!TEAMS.amarela.subdomain) {
    console.warn("[Config] KOMMO_AMARELA_SUBDOMAIN não configurado — Equipe Amarela desativada");
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd kommo-mcp-agent && npm run build 2>&1 | tail -20`
Expected: Only errors about removed `PIPELINE_IDS` / `ALLOWED_PIPELINE_IDS` (will fix in Task 5)

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat(multi-team): add TEAMS config with azul/amarela"
```

---

### Task 2: Update token-store.ts — team-scoped keys

**Files:**
- Modify: `src/services/token-store.ts` (full rewrite)

**Step 1: Replace `src/services/token-store.ts` with:**

```typescript
import { createClient } from "@supabase/supabase-js";
import { TeamKey } from "../config.js";

function getClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export interface KommoTokens {
  accessToken: string;
  refreshToken: string;
}

export async function loadTokens(team: TeamKey): Promise<KommoTokens | null> {
  const supabase = getClient();
  const accessKey = `kommo_${team}_access_token`;
  const refreshKey = `kommo_${team}_refresh_token`;

  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", [accessKey, refreshKey]);

  if (error || !data || data.length === 0) return null;

  const map = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
  const accessToken = map[accessKey] || "";
  const refreshToken = map[refreshKey] || "";

  if (!accessToken) return null;
  return { accessToken, refreshToken };
}

export async function saveTokens(team: TeamKey, tokens: KommoTokens): Promise<void> {
  const supabase = getClient();
  await supabase.from("settings").upsert([
    { key: `kommo_${team}_access_token`, value: tokens.accessToken, updated_at: new Date().toISOString() },
    { key: `kommo_${team}_refresh_token`, value: tokens.refreshToken, updated_at: new Date().toISOString() },
  ]);
}
```

**Step 2: Verify compiles**

Run: `npm run build 2>&1 | grep "error TS"`
Expected: Errors about `loadTokens`/`saveTokens` call signatures in kommo.ts (will fix next)

**Step 3: Commit**

```bash
git add src/services/token-store.ts
git commit -m "feat(multi-team): team-scoped token storage keys"
```

---

### Task 3: Update kommo.ts — accept team key

**Files:**
- Modify: `src/services/kommo.ts`

**Step 1: Change constructor signature and token calls**

Replace the constructor and token methods. Find these sections and change:

At line 6-43, update class definition:

```typescript
import axios, { AxiosInstance } from "axios";
import { KommoConfig, Lead, Message } from "../types/index.js";
import qs from "qs";
import { loadTokens, saveTokens } from "./token-store.js";
import { TeamKey } from "../config.js";

export class KommoService {
    public client: AxiosInstance;
    private config: KommoConfig;
    private currentAccessToken: string;
    private team: TeamKey;

    constructor(config: KommoConfig, team: TeamKey) {
        this.config = config;
        this.team = team;
        this.currentAccessToken = config.accessToken ?? "";
        this.client = axios.create({
            baseURL: `https://${config.subdomain}.kommo.com/api/v4`,
            headers: {
                Authorization: `Bearer ${config.accessToken}`,
                "Content-Type": "application/json",
            },
            paramsSerializer: {
                serialize: (params) => qs.stringify(params, { arrayFormat: 'brackets' })
            }
        });

        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const original = error.config;
                if (error.response?.status === 401 && !original._retried) {
                    original._retried = true;
                    try {
                        const newToken = await this.refreshAccessToken();
                        original.headers["Authorization"] = `Bearer ${newToken}`;
                        return this.client(original);
                    } catch (refreshErr) {
                        console.error(`[KommoService:${this.team}] Token refresh failed:`, refreshErr);
                    }
                }
                return Promise.reject(error);
            }
        );
    }

    public async loadStoredToken(): Promise<void> {
        try {
            const stored = await loadTokens(this.team);
            if (stored?.accessToken && stored.accessToken !== this.currentAccessToken) {
                console.log(`[KommoService:${this.team}] Using stored access token from Supabase`);
                this.setAccessToken(stored.accessToken);
            }
        } catch (e) {
            console.warn(`[KommoService:${this.team}] Could not load stored token, using env token:`, e);
        }
    }

    private setAccessToken(token: string): void {
        this.currentAccessToken = token;
        this.client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    }

    public async refreshAccessToken(): Promise<string> {
        const stored = await loadTokens(this.team);
        if (!stored?.refreshToken) {
            throw new Error(`[${this.team}] No refresh token available. Please re-authorize via the admin panel.`);
        }

        console.log(`[KommoService:${this.team}] Refreshing access token...`);
        const response = await axios.post(
            `https://${this.config.subdomain}.kommo.com/oauth2/access_token`,
            {
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                grant_type: "refresh_token",
                refresh_token: stored.refreshToken,
                redirect_uri: this.config.redirectUri,
            }
        );

        const { access_token, refresh_token } = response.data;
        await saveTokens(this.team, { accessToken: access_token, refreshToken: refresh_token });
        this.setAccessToken(access_token);
        console.log(`[KommoService:${this.team}] Token refreshed and saved.`);
        return access_token;
    }

    public async exchangeAuthCode(code: string): Promise<{ accessToken: string; refreshToken: string }> {
        const response = await axios.post(
            `https://${this.config.subdomain}.kommo.com/oauth2/access_token`,
            {
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                grant_type: "authorization_code",
                code,
                redirect_uri: this.config.redirectUri,
            }
        );

        const { access_token, refresh_token } = response.data;
        await saveTokens(this.team, { accessToken: access_token, refreshToken: refresh_token });
        this.setAccessToken(access_token);
        console.log(`[KommoService:${this.team}] Authorization code exchanged, tokens saved.`);
        return { accessToken: access_token, refreshToken: refresh_token };
    }
```

Keep `getRecentLeads`, `getLeadDetails`, `getLeadNotes`, `addNote`, `getUsers`, `getEvents`, `getPipelines`, `getLeads` methods unchanged (they don't reference the team).

**Step 2: Verify compiles**

Run: `npm run build 2>&1 | grep "error TS"`
Expected: Error in `index.ts` about `new KommoService(kommoConfig)` missing second arg (fix in Task 6)

**Step 3: Commit**

```bash
git add src/services/kommo.ts
git commit -m "feat(multi-team): KommoService accepts team key for token routing"
```

---

### Task 4: Update crm-cache.ts — dynamic pipelines, two caches

**Files:**
- Modify: `src/api/cache/crm-cache.ts` (full rewrite)

**Step 1: Replace `src/api/cache/crm-cache.ts` with:**

```typescript
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";

export interface VendedorMetrics {
  nome: string;
  funil: string;
  team: TeamKey;
  total: number;
  ganhos: number;
  perdidos: number;
  ativos: number;
  conversao: string;
  novosSemana: number;
  novosMes: number;
}

export interface FunilMetrics {
  nome: string;
  team: TeamKey;
  total: number;
  ganhos: number;
  perdidos: number;
  ativos: number;
  conversao: string;
  novosSemana: number;
  novosMes: number;
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
  atualizadoEm: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

const STATUS = { WON: 142, LOST: 143 };

interface CacheEntry {
  metrics: CrmMetrics | null;
  expiresAt: number;
  fetchPromise: Promise<CrmMetrics> | null;
}

const caches: Record<TeamKey, CacheEntry> = {
  azul: { metrics: null, expiresAt: 0, fetchPromise: null },
  amarela: { metrics: null, expiresAt: 0, fetchPromise: null },
};

function toConversao(ganhos: number, perdidos: number): string {
  const total = ganhos + perdidos;
  if (total === 0) return "0.0%";
  return ((ganhos / total) * 100).toFixed(1) + "%";
}

function countPeriod(leads: any[], days: number): number {
  const cutoff = Date.now() / 1000 - days * 86400;
  return leads.filter((l) => l.created_at >= cutoff).length;
}

async function fetchAndCompute(team: TeamKey, service: KommoService): Promise<CrmMetrics> {
  console.log(`[CrmCache:${team}] Buscando dados do CRM...`);

  const excludeNames = TEAMS[team].excludePipelineNames;

  // Fetch all pipelines dynamically
  const allPipelines = await service.getPipelines();
  const pipelines = allPipelines.filter(
    (p: any) => !excludeNames.some((ex) => p.name.toUpperCase().includes(ex.toUpperCase()))
  );

  if (pipelines.length === 0) {
    console.warn(`[CrmCache:${team}] Nenhum pipeline encontrado após filtro`);
    return {
      funis: {},
      vendedores: [],
      geral: { total: 0, ganhos: 0, perdidos: 0, ativos: 0, conversao: "0.0%", novosHoje: 0, novosSemana: 0, novosMes: 0 },
      atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };
  }

  const [users, ...leadsPerPipeline] = await Promise.all([
    service.getUsers(),
    ...pipelines.map((p: any) => service.getLeads({ filter: { pipeline_id: p.id } })),
  ]);

  const leadsPerFunil: Record<string, { nome: string; leads: any[] }> = {};
  pipelines.forEach((p: any, i: number) => {
    leadsPerFunil[String(p.id)] = { nome: p.name, leads: leadsPerPipeline[i] };
  });

  const allLeads = leadsPerPipeline.flat();

  // Métricas por funil
  const funis: Record<string, FunilMetrics> = {};
  for (const [key, { nome, leads }] of Object.entries(leadsPerFunil)) {
    const ganhos = leads.filter((l) => l.status_id === STATUS.WON).length;
    const perdidos = leads.filter((l) => l.status_id === STATUS.LOST).length;
    const ativos = leads.length - ganhos - perdidos;
    funis[key] = {
      nome,
      team,
      total: leads.length,
      ganhos,
      perdidos,
      ativos,
      conversao: toConversao(ganhos, perdidos),
      novosSemana: countPeriod(leads, 7),
      novosMes: countPeriod(leads, 30),
    };
  }

  // Métricas por vendedor × funil
  const vendedores: VendedorMetrics[] = [];
  for (const user of users) {
    for (const [, { nome, leads }] of Object.entries(leadsPerFunil)) {
      const mine = leads.filter((l) => l.responsible_user_id === user.id);
      if (mine.length === 0) continue;
      const ganhos = mine.filter((l) => l.status_id === STATUS.WON).length;
      const perdidos = mine.filter((l) => l.status_id === STATUS.LOST).length;
      vendedores.push({
        nome: user.name,
        funil: nome,
        team,
        total: mine.length,
        ganhos,
        perdidos,
        ativos: mine.length - ganhos - perdidos,
        conversao: toConversao(ganhos, perdidos),
        novosSemana: countPeriod(mine, 7),
        novosMes: countPeriod(mine, 30),
      });
    }
  }

  const totalGanhos = allLeads.filter((l) => l.status_id === STATUS.WON).length;
  const totalPerdidos = allLeads.filter((l) => l.status_id === STATUS.LOST).length;

  const geral = {
    total: allLeads.length,
    ganhos: totalGanhos,
    perdidos: totalPerdidos,
    ativos: allLeads.length - totalGanhos - totalPerdidos,
    conversao: toConversao(totalGanhos, totalPerdidos),
    novosHoje: countPeriod(allLeads, 1),
    novosSemana: countPeriod(allLeads, 7),
    novosMes: countPeriod(allLeads, 30),
  };

  console.log(`[CrmCache:${team}] Pronto — ${allLeads.length} leads, ${vendedores.length} entradas de vendedor`);

  return {
    funis,
    vendedores,
    geral,
    atualizadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

export async function getCrmMetrics(team: TeamKey, service: KommoService): Promise<CrmMetrics> {
  const entry = caches[team];
  const now = Date.now();

  if (entry.metrics && now < entry.expiresAt) return entry.metrics;

  if (entry.metrics && !entry.fetchPromise) {
    entry.fetchPromise = fetchAndCompute(team, service)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${team}] Erro no refresh:`, err);
        return entry.metrics!;
      })
      .finally(() => { entry.fetchPromise = null; });
    return entry.metrics;
  }

  if (!entry.fetchPromise) {
    entry.fetchPromise = fetchAndCompute(team, service)
      .then((metrics) => {
        entry.metrics = metrics;
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
        return metrics;
      })
      .catch((err) => {
        console.error(`[CrmCache:${team}] Erro no fetch inicial:`, err);
        throw err;
      })
      .finally(() => { entry.fetchPromise = null; });
  }

  return entry.fetchPromise;
}
```

**Step 2: Verify compiles**

Run: `npm run build 2>&1 | grep "error TS"`
Expected: Errors in routes that call `getCrmMetrics(service)` with old signature (will fix in Tasks 8-11)

**Step 3: Commit**

```bash
git add src/api/cache/crm-cache.ts
git commit -m "feat(multi-team): dynamic pipeline discovery, two caches"
```

---

### Task 5: Update requireAuth.ts — attach userTeams to request

**Files:**
- Modify: `src/api/middleware/requireAuth.ts`

**Step 1: Replace `src/api/middleware/requireAuth.ts` with:**

```typescript
import { Request, Response, NextFunction } from "express";
import { supabase } from "../supabase.js";
import { TeamKey } from "../../config.js";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  userTeams?: TeamKey[];
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Token não fornecido." });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "Token inválido." });
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("status, role, teams")
    .eq("id", user.id)
    .single();

  if (!profile || profile.status !== "approved") {
    res.status(403).json({ error: "Acesso pendente de aprovação." });
    return;
  }

  req.userId = user.id;
  req.userRole = profile.role;
  req.userTeams = (profile.teams || []) as TeamKey[];
  next();
}

export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  await requireAuth(req, res, async () => {
    if (req.userRole !== "admin") {
      res.status(403).json({ error: "Acesso restrito a administradores." });
      return;
    }
    next();
  });
}
```

**Step 2: Commit**

```bash
git add src/api/middleware/requireAuth.ts
git commit -m "feat(multi-team): attach userTeams to AuthRequest"
```

---

### Task 6: Update index.ts and server.ts — two services

**Files:**
- Modify: `src/api/index.ts`
- Modify: `src/api/server.ts`

**Step 1: Replace `src/api/index.ts` with:**

```typescript
import { TEAMS, validateConfig, PORT } from "../config.js";
import { KommoService } from "../services/kommo.js";
import { createServer } from "./server.js";
import { getCrmMetrics } from "./cache/crm-cache.js";

validateConfig();

const services = {
  azul: new KommoService(TEAMS.azul, "azul"),
  amarela: new KommoService(TEAMS.amarela, "amarela"),
};

const app = createServer(services);

app.listen(PORT, async () => {
  console.log(`Web server rodando em http://localhost:${PORT}`);
  await services.azul.loadStoredToken();
  if (TEAMS.amarela.subdomain) {
    await services.amarela.loadStoredToken();
  }
  // Warm-up caches in background
  getCrmMetrics("azul", services.azul).catch((e) =>
    console.error("[WarmUp:azul] Erro ao pré-carregar cache:", e)
  );
  if (TEAMS.amarela.subdomain) {
    getCrmMetrics("amarela", services.amarela).catch((e) =>
      console.error("[WarmUp:amarela] Erro ao pré-carregar cache:", e)
    );
  }
});
```

**Step 2: Replace `src/api/server.ts` with:**

```typescript
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { KommoService } from "../services/kommo.js";
import { TeamKey } from "../config.js";
import { pipelinesRouter } from "./routes/pipelines.js";
import { leadsRouter } from "./routes/leads.js";
import { reportsRouter } from "./routes/reports.js";
import { chatRouter } from "./routes/chat.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { oauthRouter } from "./routes/oauth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(services: Record<TeamKey, KommoService>) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/pipelines", pipelinesRouter(services));
  app.use("/api/leads", leadsRouter(services));
  app.use("/api/reports", reportsRouter(services));
  app.use("/api/chat", chatRouter(services));
  app.use("/api/auth", authRouter());
  app.use("/api/admin", adminRouter());
  app.use("/api/oauth", oauthRouter(services));

  const webPath = join(__dirname, "../../web/dist");
  app.use(express.static(webPath));

  app.get(/(.*)/, (_req, res) => {
    res.sendFile(join(webPath, "index.html"));
  });

  return app;
}
```

**Step 3: Commit**

```bash
git add src/api/index.ts src/api/server.ts
git commit -m "feat(multi-team): create two KommoService instances at startup"
```

---

### Task 7: Update pipelines.ts — serve all authorized teams

**Files:**
- Modify: `src/api/routes/pipelines.ts`

**Step 1: Replace `src/api/routes/pipelines.ts` with:**

```typescript
import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

export function pipelinesRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/pipelines — pipelines from all authorized teams
  router.get("/", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    try {
      const results: Array<{ id: number; name: string; team: TeamKey }> = [];

      for (const team of userTeams) {
        const service = services[team];
        if (!service || !TEAMS[team].subdomain) continue;

        const excludeNames = TEAMS[team].excludePipelineNames;
        const pipelines = await service.getPipelines();
        const filtered = pipelines.filter(
          (p: any) => !excludeNames.some((ex) => p.name.toUpperCase().includes(ex.toUpperCase()))
        );
        filtered.forEach((p: any) => results.push({ id: p.id, name: p.name, team }));
      }

      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
```

**Step 2: Commit**

```bash
git add src/api/routes/pipelines.ts
git commit -m "feat(multi-team): pipelines route serves all authorized teams"
```

---

### Task 8: Update leads.ts — route to correct team service

**Files:**
- Modify: `src/api/routes/leads.ts`

**Step 1: Replace `src/api/routes/leads.ts` with:**

```typescript
import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey, TEAMS } from "../../config.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

function formatDateOnly(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

function formatDateTimeGMT3(date: Date): string {
  const gmt3Time = date.getTime() + -3 * 60 * 60 * 1000;
  const d = new Date(gmt3Time);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min} (GMT-3)`;
}

export function leadsRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/leads/new/:pipelineId — find which team owns this pipeline, then fetch leads
  router.get("/new/:pipelineId", async (req: AuthRequest, res) => {
    const { pipelineId } = req.params;
    const { from, to } = req.query;
    const userTeams = req.userTeams || [];

    try {
      // Find the team that owns this pipeline ID
      let service: KommoService | null = null;
      let pipe: any = null;

      for (const team of userTeams) {
        if (!TEAMS[team].subdomain) continue;
        const pipelines = await services[team].getPipelines();
        const found = pipelines.find((p: any) => p.id === parseInt(pipelineId));
        if (found) {
          service = services[team];
          pipe = found;
          break;
        }
      }

      if (!service || !pipe) {
        return res.status(404).json({ error: "Pipeline não encontrado" });
      }

      const newLeadStatuses = pipe._embedded.statuses
        .filter((s: any) =>
          s.name.toUpperCase().includes("NEW LEADS") ||
          s.name.toUpperCase().includes("ENTRADA")
        )
        .map((s: any) => s.id);

      if (newLeadStatuses.length === 0 && pipe._embedded.statuses.length > 0) {
        newLeadStatuses.push(pipe._embedded.statuses[0].id);
      }

      const filterCreated: any = { pipeline_id: [parseInt(pipelineId)] };
      if (from || to) {
        filterCreated.created_at = {};
        if (from) filterCreated.created_at.from = parseInt(from as string);
        if (to) filterCreated.created_at.to = parseInt(to as string);
      }

      const leadsCreated = await service.getLeads({ filter: filterCreated, limit: 250 });
      const filteredCreated = leadsCreated.filter(
        (l) => !l.name.toLowerCase().includes("autolead")
      );
      const remainingLeads = filteredCreated.filter((l) =>
        newLeadStatuses.includes(l.status_id)
      );

      const periodStr =
        from && to
          ? `${formatDateOnly(parseInt(from as string))} até ${formatDateOnly(parseInt(to as string))}`
          : "Geral";

      res.json({
        created: filteredCreated.length,
        remaining: remainingLeads.length,
        brand: pipe.name.replace("FUNIL ", ""),
        period: periodStr,
        fetchedAt: formatDateTimeGMT3(new Date()),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
```

**Step 2: Commit**

```bash
git add src/api/routes/leads.ts
git commit -m "feat(multi-team): leads route discovers pipeline team dynamically"
```

---

### Task 9: Update reports.ts — merge agents from all teams

**Files:**
- Modify: `src/api/routes/reports.ts`

**Step 1: Replace `src/api/routes/reports.ts` with:**

```typescript
import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { TeamKey } from "../../config.js";
import { getCrmMetrics } from "../cache/crm-cache.js";
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";

export function reportsRouter(services: Record<TeamKey, KommoService>) {
  const router = Router();
  router.use(requireAuth as any);

  // GET /api/reports/agents — performance de agentes de todas as equipes autorizadas
  router.get("/agents", async (req: AuthRequest, res) => {
    const userTeams = req.userTeams || [];
    try {
      const byAgent: Record<string, {
        Agente: string;
        "Total Leads": number;
        _won: number;
        _lost: number;
        funnels: Record<string, number>;
      }> = {};

      for (const team of userTeams) {
        const service = services[team];
        if (!service) continue;

        const metrics = await getCrmMetrics(team, service);

        for (const v of metrics.vendedores) {
          if (!byAgent[v.nome]) {
            byAgent[v.nome] = { Agente: v.nome, "Total Leads": 0, _won: 0, _lost: 0, funnels: {} };
          }
          byAgent[v.nome]["Total Leads"] += v.total;
          byAgent[v.nome]._won += v.ganhos;
          byAgent[v.nome]._lost += v.perdidos;
          byAgent[v.nome].funnels[v.funil.replace("FUNIL ", "")] = v.ativos;
        }
      }

      const rows = Object.values(byAgent)
        .sort((a, b) => b["Total Leads"] - a["Total Leads"])
        .map((a) => {
          const total = a["Total Leads"] || 1;
          const wonPct = ((a._won / total) * 100).toFixed(1);
          const lostPct = ((a._lost / total) * 100).toFixed(1);
          const convBase = a._won + a._lost;
          const convPct = convBase > 0 ? ((a._won / convBase) * 100).toFixed(1) : "0.0";
          return {
            Agente: a.Agente,
            "Total Leads": a["Total Leads"],
            "Venda Ganha": `${a._won} (${wonPct}%)`,
            "Venda Perdida": `${a._lost} (${lostPct}%)`,
            "Conversão %": `${convPct}%`,
            ...a.funnels,
          };
        });

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
```

**Step 2: Commit**

```bash
git add src/api/routes/reports.ts
git commit -m "feat(multi-team): reports aggregates agents from all authorized teams"
```

---

### Task 10: Update chat.ts — include metrics from all teams

**Files:**
- Modify: `src/api/routes/chat.ts` — only the `chatRouter` function signature and `getCrmMetrics` calls

**Step 1: Update `src/api/routes/chat.ts`**

Change line 5: `import { getCrmMetrics, CrmMetrics } from "../cache/crm-cache.js";`

Change `buildSystemPrompt` to accept an array:

```typescript
function buildSystemPrompt(allMetrics: Array<{ team: string; label: string; metrics: CrmMetrics }>): string {
  const sections = allMetrics.map(({ label, metrics }) => {
    const { funis, vendedores, geral } = metrics;

    const funisTexto = Object.values(funis)
      .map((f) =>
        `  ${f.nome}: ${f.total} leads | ganhos: ${f.ganhos} | perdidos: ${f.perdidos} | ativos: ${f.ativos} | conversão: ${f.conversao} | novos semana: ${f.novosSemana} | novos mês: ${f.novosMes}`
      )
      .join("\n");

    const vendedoresTexto = vendedores
      .map((v) =>
        `  ${v.nome} | ${v.funil} | total: ${v.total} | ganhos: ${v.ganhos} | perdidos: ${v.perdidos} | ativos: ${v.ativos} | conversão: ${v.conversao} | novos semana: ${v.novosSemana} | novos mês: ${v.novosMes}`
      )
      .join("\n");

    return `## ${label.toUpperCase()} — ATUALIZADO EM: ${metrics.atualizadoEm}

RESUMO GERAL: ${geral.total} leads | ganhos: ${geral.ganhos} | perdidos: ${geral.perdidos} | ativos: ${geral.ativos} | conversão: ${geral.conversao} | novos hoje: ${geral.novosHoje}

MÉTRICAS POR FUNIL:
${funisTexto}

MÉTRICAS POR VENDEDOR × FUNIL:
${vendedoresTexto}`;
  });

  return `Você é o assistente inteligente do Kommo CRM da empresa.
Responda perguntas de gerentes com precisão, profissionalismo e análise aprofundada.

${sections.join("\n\n---\n\n")}

## REGRAS
- Responda SEMPRE em Português Brasil.
- Use Markdown (tabelas, negrito, listas) para formatar respostas.
- Baseie suas respostas EXCLUSIVAMENTE nos dados acima.
- Se não tiver o dado solicitado, informe claramente que a informação não está disponível no contexto.
- Para rankings, ordene do maior para o menor.
- Conversão = ganhos ÷ (ganhos + perdidos) × 100.`;
}
```

Change function signature:
```typescript
export function chatRouter(services: Record<TeamKey, KommoService>) {
```

Add import at top:
```typescript
import { TeamKey, TEAMS } from "../../config.js";
```

Replace the `getCrmMetrics(service)` call inside the route:
```typescript
      // Fetch metrics for all user's authorized teams
      const userTeams = (req as AuthRequest).userTeams || [];
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

Also add `AuthRequest` to the import from `requireAuth`:
```typescript
import { requireAuth, AuthRequest } from "../middleware/requireAuth.js";
```

**Step 2: Compile check**

Run: `npm run build 2>&1 | grep "error TS"`
Expected: 0 errors (or only errors in oauth.ts)

**Step 3: Commit**

```bash
git add src/api/routes/chat.ts
git commit -m "feat(multi-team): chat includes metrics from all authorized teams"
```

---

### Task 11: Update admin.ts — approve with teams

**Files:**
- Modify: `src/api/routes/admin.ts`

**Step 1: Replace the approve endpoint (lines 25-36) with:**

```typescript
  // POST /api/admin/users/:id/approve
  router.post("/users/:id/approve", async (req, res) => {
    const { teams } = req.body; // e.g. ["azul"] or ["azul","amarela"]
    const updateData: any = { status: "approved" };
    if (Array.isArray(teams) && teams.length > 0) {
      updateData.teams = teams;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", req.params.id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ message: "Usuário aprovado." });
  });
```

Also update the `GET /api/admin/users` query to include `teams`:
```typescript
      .select("id, name, email, status, role, teams, created_at")
```

**Step 2: Commit**

```bash
git add src/api/routes/admin.ts
git commit -m "feat(multi-team): approve endpoint accepts teams array"
```

---

### Task 12: Update oauth.ts — team-aware OAuth

**Files:**
- Modify: `src/api/routes/oauth.ts` (full rewrite)

**Step 1: Replace `src/api/routes/oauth.ts` with:**

```typescript
import { Router } from "express";
import { KommoService } from "../../services/kommo.js";
import { loadTokens } from "../../services/token-store.js";
import { requireAdmin } from "../middleware/requireAuth.js";
import { TEAMS, TeamKey } from "../../config.js";

export function oauthRouter(services: Record<TeamKey, KommoService>): Router {
  const router = Router();
  router.use(requireAdmin as any);

  // GET /api/oauth/start?team=azul — returns the Kommo authorization URL
  router.get("/start", (_req, res) => {
    const team = (_req.query.team as TeamKey) || "azul";
    const config = TEAMS[team];
    if (!config) {
      res.status(400).json({ error: "Team inválida." });
      return;
    }
    const authUrl =
      `https://www.kommo.com/oauth/?` +
      `client_id=${config.clientId}` +
      `&state=renew` +
      `&redirect_uri=${encodeURIComponent(config.redirectUri)}` +
      `&response_type=code`;
    res.json({ authUrl });
  });

  // POST /api/oauth/exchange?team=azul — exchange the authorization code for tokens
  router.post("/exchange", async (req, res) => {
    const team = (req.query.team as TeamKey) || "azul";
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: "Código de autorização não fornecido." });
      return;
    }
    const service = services[team];
    if (!service) {
      res.status(400).json({ error: "Team inválida." });
      return;
    }
    try {
      const tokens = await service.exchangeAuthCode(code);
      res.json({ message: "Token renovado com sucesso!", accessToken: tokens.accessToken.slice(0, 20) + "..." });
    } catch (err: any) {
      console.error(`[OAuth:${team}] Exchange failed:`, err.response?.data || err.message);
      res.status(500).json({ error: err.response?.data?.hint || err.message });
    }
  });

  // GET /api/oauth/status — token info for both teams
  router.get("/status", async (_req, res) => {
    try {
      const result: Record<TeamKey, { hasRefreshToken: boolean; expiresAt: string | null }> = {
        azul: { hasRefreshToken: false, expiresAt: null },
        amarela: { hasRefreshToken: false, expiresAt: null },
      };

      for (const team of (["azul", "amarela"] as TeamKey[])) {
        const stored = await loadTokens(team);
        result[team].hasRefreshToken = !!stored?.refreshToken;

        const token = stored?.accessToken || TEAMS[team].accessToken || "";
        if (token) {
          try {
            const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
            result[team].expiresAt = new Date(payload.exp * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          } catch { /* ignore decode errors */ }
        }
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 2: Full compile check**

Run: `npm run build 2>&1 | tail -10`
Expected: `0 errors` (TypeScript build success)

**Step 3: Commit**

```bash
git add src/api/routes/oauth.ts
git commit -m "feat(multi-team): oauth routes support team param, status returns both teams"
```

---

### Task 13: Update frontend App.tsx — team grouping + admin UI

**Files:**
- Modify: `web/src/App.tsx`

**Step 1: Update the `Pipeline` interface (line ~19):**

```typescript
interface Pipeline {
    id: number;
    name: string;
    team: 'azul' | 'amarela';
}
```

**Step 2: Update `tokenStatus` state type (line ~146):**

```typescript
const [tokenStatus, setTokenStatus] = useState<Record<'azul' | 'amarela', { hasRefreshToken: boolean; expiresAt: string | null }> | null>(null);
const [oauthCode, setOauthCode] = useState<Record<'azul' | 'amarela', string>>({ azul: '', amarela: '' });
const [oauthMsg, setOauthMsg] = useState<Record<'azul' | 'amarela', string>>({ azul: '', amarela: '' });
```

**Step 3: Update `handleOauthExchange` and `openKommoAuth` to accept team:**

```typescript
    const handleOauthExchange = async (team: 'azul' | 'amarela') => {
        const code = oauthCode[team];
        if (!code.trim()) return;
        setOauthMsg(prev => ({ ...prev, [team]: '' }));
        try {
            const res = await axios.post(`/api/oauth/exchange?team=${team}`,
                { code: code.trim() },
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            setOauthMsg(prev => ({ ...prev, [team]: '✅ ' + res.data.message }));
            setOauthCode(prev => ({ ...prev, [team]: '' }));
            const statusRes = await axios.get('/api/oauth/status', { headers: { Authorization: `Bearer ${authToken}` } });
            setTokenStatus(statusRes.data);
        } catch (err: any) {
            setOauthMsg(prev => ({ ...prev, [team]: '❌ ' + (err.response?.data?.error || 'Erro ao trocar o código.') }));
        }
    };

    const openKommoAuth = async (team: 'azul' | 'amarela') => {
        const res = await axios.get(`/api/oauth/start?team=${team}`, { headers: { Authorization: `Bearer ${authToken}` } });
        window.open(res.data.authUrl, '_blank');
    };
```

**Step 4: Update sidebar — group pipelines by team**

Replace the `<div className="group"><label>Marcas</label>...` section with:

```tsx
                    {(['azul', 'amarela'] as const)
                        .filter(team => pipelines.some(p => p.team === team))
                        .map(team => (
                            <div className="group" key={team}>
                                <label className={`team-label ${team}`}>
                                    {team === 'azul' ? 'Equipe Azul' : 'Equipe Amarela'}
                                </label>
                                {pipelines.filter(p => p.team === team).map(p => (
                                    <button
                                        key={p.id}
                                        className={activeTab === `brand-${p.id}` && page !== 'admin' ? 'active' : ''}
                                        onClick={() => { setPage('app'); loadTabData(`brand-${p.id}`); }}
                                    >
                                        <ChevronRight size={14} /> {p.name.replace('FUNIL ', '').substring(0, 15)}
                                    </button>
                                ))}
                            </div>
                        ))
                    }
```

**Step 5: Update admin panel — Token Kommo section**

Replace the single `<div className="admin-section"><h2>Token Kommo</h2>...` with two cards:

```tsx
                    <div className="admin-section">
                        <h2>Token Kommo</h2>
                        {(['azul', 'amarela'] as const).map(team => (
                            <div key={team} style={{ marginBottom: '1rem' }}>
                                <p style={{ fontSize: '0.8rem', fontWeight: 700, color: team === 'azul' ? '#3b82f6' : '#f59e0b', marginBottom: '0.5rem' }}>
                                    {team === 'azul' ? 'Equipe Azul' : 'Equipe Amarela'}
                                </p>
                                <div className="token-status-card glass">
                                    <div className="token-info">
                                        <span className="token-label">Expira em:</span>
                                        <span className="token-value">{tokenStatus?.[team]?.expiresAt ?? '—'}</span>
                                    </div>
                                    <div className="token-info">
                                        <span className="token-label">Refresh token:</span>
                                        <span className={`status-badge ${tokenStatus?.[team]?.hasRefreshToken ? 'approved' : 'denied'}`}>
                                            {tokenStatus?.[team]?.hasRefreshToken ? 'configurado' : 'não configurado'}
                                        </span>
                                    </div>
                                    <div className="token-renew">
                                        <p className="token-instructions">
                                            Para renovar: clique em <strong>Autorizar Kommo</strong>, aprove o acesso,
                                            copie o parâmetro <code>code</code> da URL e cole abaixo.
                                        </p>
                                        <button className="action-btn approve" style={{ padding: '6px 16px' }} onClick={() => openKommoAuth(team)}>
                                            Autorizar Kommo ↗
                                        </button>
                                        <div className="oauth-input-row">
                                            <input
                                                type="text"
                                                placeholder="Cole o código aqui (parâmetro code=...)"
                                                value={oauthCode[team]}
                                                onChange={e => setOauthCode(prev => ({ ...prev, [team]: e.target.value }))}
                                            />
                                            <button className="action-btn approve" onClick={() => handleOauthExchange(team)} disabled={!oauthCode[team].trim()}>
                                                Confirmar
                                            </button>
                                        </div>
                                        {oauthMsg[team] && <p className="oauth-msg">{oauthMsg[team]}</p>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
```

**Step 6: Update admin approval to include team checkboxes**

Add state near other admin state:
```typescript
const [approveTeams, setApproveTeams] = useState<Record<string, { azul: boolean; amarela: boolean }>>({});
```

Update `handleApprove`:
```typescript
    const handleApprove = async (userId: string) => {
        const sel = approveTeams[userId] || { azul: true, amarela: false };
        const teams = (['azul', 'amarela'] as const).filter(t => sel[t]);
        await axios.post(`/api/admin/users/${userId}/approve`, { teams }, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        loadAdminPanel();
    };
```

In the admin users table, add checkboxes in the "Ações" column before the Approve button:
```tsx
                                                    <td>
                                                        {u.status !== 'approved' && (
                                                            <>
                                                                <label style={{ fontSize: '0.75rem', marginRight: '6px' }}>
                                                                    <input type="checkbox"
                                                                        checked={approveTeams[u.id]?.azul ?? true}
                                                                        onChange={e => setApproveTeams(prev => ({ ...prev, [u.id]: { ...(prev[u.id] || { azul: true, amarela: false }), azul: e.target.checked } }))}
                                                                    /> Azul
                                                                </label>
                                                                <label style={{ fontSize: '0.75rem', marginRight: '6px' }}>
                                                                    <input type="checkbox"
                                                                        checked={approveTeams[u.id]?.amarela ?? false}
                                                                        onChange={e => setApproveTeams(prev => ({ ...prev, [u.id]: { ...(prev[u.id] || { azul: true, amarela: false }), amarela: e.target.checked } }))}
                                                                    /> Amarela
                                                                </label>
                                                                <button className="action-btn approve" onClick={() => handleApprove(u.id)}>Aprovar</button>
                                                            </>
                                                        )}
                                                        {u.status !== 'denied' && (
                                                            <button className="action-btn deny" onClick={() => handleDeny(u.id)}>Negar</button>
                                                        )}
                                                    </td>
```

**Step 7: Compile frontend check**

Run: `cd web && npx tsc --noEmit 2>&1 | tail -20`
Expected: 0 errors

**Step 8: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(multi-team): frontend sidebar groups by team, admin shows both OAuth cards"
```

---

### Task 14: Add team CSS + full build + push

**Files:**
- Modify: `web/src/index.css` — add team label styles
- Build and push

**Step 1: Add CSS at end of `web/src/index.css`:**

```css
/* Team labels in sidebar */
.team-label {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 0.25rem 0.75rem 0.1rem;
}

.team-label.azul { color: #3b82f6; }
.team-label.amarela { color: #f59e0b; }
```

**Step 2: Full build**

Run: `cd /path/to/kommo-mcp-agent && npm run build:all 2>&1 | tail -15`
Expected: `✓ built in ...ms` and `0 errors`

**Step 3: Commit and push**

```bash
git add web/src/index.css web/dist
git commit -m "feat(multi-team): team CSS labels, production build"
git push
```

Railway will auto-deploy (~3 min).

---

## Post-Deploy Checklist

1. Run the Supabase SQL from the Pre-requisite section
2. Add Railway env vars (`KOMMO_AMARELA_*`)
3. Login to admin panel → Admin → Token Kommo → **Equipe Amarela** → Autorizar Kommo → exchange code
4. Verify pipelines from both teams appear in sidebar
5. Verify agent report shows agents from both teams
