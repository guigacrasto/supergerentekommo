# Admin Panel Microservice — Design Doc

## Goal

Isolate the admin panel (user approval, mentor CRUD, OAuth token management, token usage analytics, pipeline visibility) into an independent microservice with its own frontend and backend, deployed separately from the main app.

## Motivation

1. **Deploy independente** — atualizar admin sem afetar o app principal e vice-versa
2. **Estabilidade** — dados carregam em um mas não no outro; separar elimina interferência
3. **Acesso separado** — admin em URL própria, sem presença no app principal
4. **Performance** — admin consome Kommo API e Supabase sem impactar usuários normais

## Architecture

**Approach:** Full-stack admin separado dentro do monorepo.

```
kommo-mcp-agent/               (workspace root)
├── src/                        backend app principal (Express, porta 3000)
├── web/                        frontend app principal (React, Vercel/Railway)
├── admin/
│   ├── api/                    backend admin (Express, porta 3001)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── railway.toml
│   │   └── src/
│   │       ├── server.ts
│   │       ├── routes/
│   │       │   ├── admin.ts    users, mentors, tokens, pipeline-visibility
│   │       │   └── oauth.ts    start, exchange, status
│   │       ├── middleware/
│   │       │   └── requireAuth.ts
│   │       └── services/
│   │           └── kommo.ts    enxuto: exchangeAuthCode, refreshToken, getPipelines
│   └── web/                    frontend admin (React, Vercel)
│       ├── package.json
│       ├── vite.config.ts
│       ├── vercel.json
│       └── src/
│           ├── App.tsx         Router: /login + / (admin tabs)
│           ├── pages/
│           │   ├── LoginPage.tsx
│           │   └── AdminPage.tsx
│           ├── components/     UserTable, MentorList, MentorForm, TokenPanel, TokenUsage, PipelineVisibility
│           ├── stores/         authStore (Zustand)
│           └── lib/            api.ts, utils.ts
├── packages/
│   └── shared/
│       ├── package.json
│       └── src/
│           ├── types.ts        Team, TokenStatus, AdminUser, Mentor, TokenUsage, etc.
│           ├── config.ts       TEAMS, TeamKey, TeamConfig
│           └── supabase.ts     Supabase client factory
└── package.json                workspace root (npm workspaces)
```

## Admin Backend

- **Express standalone** na porta 3001
- **Railway service:** `supergerente-admin` (deploy independente)
- **Env vars:** mesmas do app principal (KOMMO_*, SUPABASE_*, GEMINI_API_KEY)
- **Auth:** `requireAdmin` middleware — valida JWT Supabase + `role === 'admin'`

### Routes migrated from main app

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/users` | GET | List non-admin users |
| `/api/admin/users/:id/approve` | POST | Approve user + assign teams |
| `/api/admin/users/:id/deny` | POST | Deny user |
| `/api/admin/mentors` | GET/POST | List/Create mentors |
| `/api/admin/mentors/:id` | PUT/DELETE | Update/Delete mentor |
| `/api/admin/tokens` | GET | Token usage analytics (30 days) |
| `/api/admin/pipeline-visibility` | GET/PUT | Pipeline visibility toggles |
| `/api/oauth/start` | GET | Kommo OAuth authorization URL |
| `/api/oauth/exchange` | POST | Exchange code for tokens |
| `/api/oauth/status` | GET | Token status per team |

### KommoService (lean copy)

Only methods admin needs:
- `exchangeAuthCode(code)` — OAuth token exchange
- `refreshToken()` — proactive token refresh
- `getPipelines()` — fetch pipelines for visibility management

Does NOT include: `getRecentLeads`, `getContacts`, `getConversations`, etc.

## Admin Frontend

- **Stack:** React 18 + Vite + Tailwind v4 + Zustand (same as main app)
- **Design system:** Cleverwise (same tokens, same look)
- **Deploy:** Vercel, URL: `supergerente-admin.vercel.app` (or custom domain)
- **Build:** `cd admin/web && npm run build`

### Pages

- `/login` — Admin-only login. No registration. Shows error if user is not admin.
- `/` — Admin dashboard with 5 tabs: Usuarios, Mentores, Tokens, Uso, Visibilidade

### Components migrated from main app

- `UserTable` — user approval with team checkboxes
- `MentorList` + `MentorForm` — mentor CRUD
- `TokenPanel` — OAuth token status and renewal
- `TokenUsage` — token consumption analytics table
- `PipelineVisibility` — pipeline toggle grid by team

## Shared Package (`packages/shared`)

npm workspace package imported by all 3 projects:

- **types.ts** — `Team`, `TeamKey`, `TeamConfig`, `TokenStatus`, `AdminUser`, `Mentor`, `TokenUsage`, `User`
- **config.ts** — `TEAMS` record, `validateConfig()`, `ALL_CONFIGURED_TEAMS`
- **supabase.ts** — Supabase client factory (takes URL + key as params)

## Cleanup from Main App

### Backend — remove:
- `src/api/routes/admin.ts` — all admin routes
- `src/api/routes/oauth.ts` — OAuth routes (admin-only)
- `requireAdmin` from middleware (keep `requireAuth`)
- References in `server.ts` (`app.use("/api/admin", ...)`, `app.use("/api/oauth", ...)`)

### Frontend — remove:
- `web/src/pages/AdminPage.tsx`
- `web/src/components/features/admin/` — entire folder
- Route `/admin` from `App.tsx`
- Admin link from Sidebar (no link at all — admins access via direct URL)
- Admin-specific types from local `types/` (moved to shared)

### Frontend — NO changes:
- No admin link in sidebar. Admins bookmark the admin URL directly.

## Resilience

| Scenario | Impact |
|----------|--------|
| Admin backend down | App principal unaffected |
| App principal down | Admin continues working |
| Kommo API down | Admin shows errors in TokenPanel/PipelineVisibility (existing behavior) |
| Supabase down | Both down (shared dependency, acceptable — managed infra with high uptime) |

## Deploy Topology

```
[Vercel]                          [Railway]
admin frontend ──HTTP──▶ admin backend ──▶ Supabase
                                          ◀── shared ──▶
app frontend ────HTTP──▶ app backend ────▶ Supabase
[Railway static]                  [Railway]
```

Both backends read/write the same Supabase project. No sync needed.
