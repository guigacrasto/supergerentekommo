# Changelog — SuperGerente

Todas as alterações notáveis do projeto são documentadas aqui.

---

## [2026-04-01] — Lead Remanejamento Automation

### Adicionado
- **Lead Remanejamento** (`src/services/lead-remanejamento.ts`): Automacao diaria (4h BRT) que remaneja leads estagnados no tenant GAME
  - **Regra R1**: Leads em "EM ATENDIMENTO" (azul) / "CLIENTE INTERESSADO" (amarelo) ha 10+ dias sem nenhuma nota → cria novo lead em "NEW LEADS 2" + fecha antigo como venda perdida
  - **Regra R2**: Leads em "N ATENDEU/ CX POSTAL /SEM RESPOSTA" ha 15+ dias → mesmo remanejamento
  - Roda em ambas as contas Kommo (azul + amarela) e todos os funis
  - Email CSV diario para guilherme@onigroup.com.br com relatorio dos leads movidos
- **KommoService.createLead()**: Novo metodo para criar leads via API Kommo POST /leads

---

## [2026-03-08] — Multi-Tenant Architecture

### Adicionado
- **Multi-Tenant**: Arquitetura Single DB + tenant_id + RLS para suportar 20+ clientes isolados
- **Tabela `tenants`**: Nome, slug, logo, cor, credenciais Kommo, settings JSONB, webhook_secret
- **Migration `009-multi-tenant.sql`**: Cria tabela tenants, adiciona tenant_id a 7 tabelas, indexes, RLS
- **Tenant Service** (`src/api/services/tenant.ts`): CRUD completo com cache in-memory (5min TTL)
- **Super-Admin API** (`/api/super`): CRUD tenants, stats globais, listagem com contagem de usuários
- **Middleware `requireSuperAdmin`**: Guard para rotas super-admin
- **Tenant Switcher** (frontend): Dropdown no TopBar para superadmin trocar contexto de tenant
- **Super Admin Page** (`/super`): KPI cards (total tenants, ativos, usuários) + TenantTable + TenantForm modal
- **TenantForm**: Modal para criar/editar tenants com auto-slug, color picker, toggle ativo/inativo
- **Header `X-Tenant-Id`**: Frontend envia tenant ativo para API (superadmin context switching)

### Modificado
- **Auth middleware**: Injeta `req.tenantId` e `req.tenant` em toda request autenticada
- **Todas as rotas backend**: Filtram dados por tenant_id (pipelines, leads, reports, chat, insights, admin, notifications, webhooks)
- **KommoService**: Tenant-aware — tokens persistidos por tenant na tabela tenants
- **Token Store**: `loadTokensFromTenant()` e `saveTokensToTenant()` para persistência multi-tenant
- **CRM Cache**: Key mudou de `TeamKey` para `tenantId:team` (Map dinâmico)
- **Activity Cache**: Mudou de `Record<TeamKey>` fixo para `Map<string>` dinâmico
- **Conversation Cache**: Signatures atualizadas para aceitar `string` em vez de `TeamKey`
- **Prediction Service**: Aceita `string` em vez de `TeamKey`
- **Route factories**: Todas mudaram de `fooRouter(services)` para `fooRouter()` sem parâmetros
- **server.ts**: Auth middleware aplicado centralmente, rota `/api/super` adicionada
- **index.ts (startup)**: Carrega tenants do DB, inicializa KommoService por tenant/team
- **auth.ts**: Login retorna tenant info na resposta
- **authStore (frontend)**: `activeTenantId` + `setActiveTenantId` com localStorage
- **api.ts (frontend)**: Interceptor envia `X-Tenant-Id` header
- **TopBar**: Integra TenantSwitcher
- **Sidebar**: Links admin/insights visíveis para superadmin, link "Super Admin" adicionado
- **App.tsx**: Rota `/super` adicionada
- **Frontend Tenant type**: Adicionado `kommoBaseUrl`
- **Config**: `validateConfig()` usa warn em vez de exit (env vars opcionais em multi-tenant)

### Design Docs
- `docs/plans/2026-03-08-multi-tenant-design.md` — Design aprovado
- `docs/plans/2026-03-08-multi-tenant-plan.md` — Plano de implementação (19 tasks)

---

## [2026-03-08] — 3 Features Finais

### Adicionado
- **Log de Auditoria**: Middleware automático registra todas as ações dos usuários no Supabase. Aba "Auditoria" no painel admin com tabela paginada. Cleanup automático de logs > 90 dias.
- **Webhooks Kommo**: Endpoint `POST /api/webhooks/kommo` recebe eventos de leads. Detecção de "lead quente" configurável. Tripla notificação: painel (polling 30s), email (Resend) e push PWA (Web Push API/VAPID).
- **Sistema de Notificações**: Tabela `notifications` + `push_subscriptions` no Supabase. NotificationBell no TopBar com badge de unread. NotificationPanel dropdown. Store Zustand dedicado.
- **Predictive Sales**: Score de probabilidade de fechamento (0-100) por lead ativo. 5 fatores: tempo no funil, última interação, qualificação, valor do deal, conversão do agente. Nova página `/predictions` com cards coloridos e breakdown de fatores.
- **Migrations**: `007-audit-logs.sql` e `008-notifications.sql`

### Modificado
- `server.ts` — novas rotas (webhooks, notifications) + middleware auditLog
- `admin.ts` — endpoints audit-logs e webhook-config
- `reports.ts` — endpoint predictions
- `App.tsx` — rota /predictions
- `Sidebar.tsx` — link "Previsões" com ícone TrendingUp
- `TopBar.tsx` — NotificationBell integrado
- `AdminPage.tsx` — seção AuditLogTable
- `.env.example` — vars VAPID + webhook secret

---

## [2026-03-07] — Auth Features + White-Label

### Adicionado
- Password reset via email (token 15min, Resend)
- Página de perfil (nome, telefone, alterar senha)
- SPA fallback no Express (React Router URLs reais)
- Documentação white-label completa

---

## [2026-03-06] — Redesign do Logo

### Alterado
- Novo logo com silhueta de pessoa + gráfico (conceito gestão)
- Ícones PWA atualizados

---

## [2026-03-05] — Cleanup Imports

### Corrigido
- Removidos imports não utilizados de APP_SHORT_NAME após substituição por logo

---

## [2026-03-04] — PWA Icons

### Adicionado
- Ícones PNG para PWA (force-tracked via gitignore)
- Logo SVG do SuperGerente

---

## [2026-03-02] — DDD + Estado + Mobile

### Adicionado
- Página de DDD (leads por código de área)
- Filtro de Estado (segue padrão FunilFilter)
- Alerta de DDD Proibido (81, 87, 83)
- Filtros padrão na AlertsPage

### Corrigido
- Removido "Não identificado" dos resultados de DDD
- Listas de funil/grupo/agente completas nos filtros de alertas

---

## [2026-03-01] — Dashboard Charts + Rankings

### Adicionado
- Gráficos de barras horizontais por agente (substituindo pie charts)
- Ranking de vendas por conversão
- KPIs por equipe (cards separados Azul/Amarela)

---

## [2026-02-28] — Admin + Insights + Alertas

### Adicionado
- Painel admin (pausar pipelines, gerenciar usuários, permissões)
- Página de Insights (análise de conversas com Gemini, filtros por funil/agente)
- Alertas de atividade (leads abandonados 48h, leads em risco 7d, tarefas vencidas)
- Cache de atividade (5min TTL)

---

## [2026-02-27] — Multi-Team + Cache

### Adicionado
- Suporte multi-equipe (Azul + Amarela com contas Kommo separadas)
- Cache de métricas CRM (5min TTL, refresh proativo 25min)
- Health check endpoint (/health) com readiness
- Auto-refresh de tokens OAuth (proativo 20h)

---

## [2026-02-10] — Projeto Inicial

### Adicionado
- Setup inicial: Express + React + Vite + Tailwind
- Integração Kommo CRM (leads, pipelines, agentes)
- Chat IA com Gemini 2.5 Flash (mentores + conselho)
- Autenticação Supabase (registro, login, aprovação)
- Dashboard com KPIs e métricas
- Páginas: Login, Register, Dashboard, Chat, Agents, Alerts
- Design system Cleverwise (dark purple, glassmorphism)
- Deploy Railway (auto-deploy on push)
