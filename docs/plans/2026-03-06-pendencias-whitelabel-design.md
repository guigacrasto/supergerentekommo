# Design — SuperGerente Pendências + White Label

**Data:** 2026-03-06
**Status:** Aprovado

---

## 1. Filtro de Tags global (`?tags=`)

- Adicionar `?tags=1,2,3&tagMode=or|and` a TODOS os endpoints de `/api/reports/*`.
- Filtrar no nível do cache response (não na API Kommo — evita re-fetch).
- Endpoints afetados: summary, dashboard, agents, activity, daily, tmf, loss-reasons, income, profession.
- Frontend: `filterStore` já tem `selectedTags`. Adicionar `tagMode: 'or' | 'and'` + toggle no UI.
- Default: OR. Toggle pra AND.

## 2. Pipelines no Admin (ocultar pra users)

- Usar tabela `settings` existente (key: `paused_pipelines`).
- Nos endpoints de reports: se `req.userRole !== 'admin'`, excluir pipelines pausados dos resultados.
- Admins continuam vendo tudo (com badge "oculto").
- Renomear UI: "Pausar" → "Ocultar dos relatórios".

## 3. Auth middleware filtrando por `allowed_funnels`

- Estender `requireAuth`: buscar `user_funnel_permissions` pra cada team do user.
- Disponibilizar `req.allowedFunnels: Record<TeamKey, number[]>` no request.
- Nos endpoints de reports: filtrar pipelines para apenas os permitidos.
- Array vazio ou sem registro = ver todos os pipelines.
- Admin bypassa filtro.

## 4. SSE no Dashboard (substituir polling)

- Expandir `/api/reports/stream` pra enviar TODOS os dados do dashboard: summary, dashboard (agents), activity.
- Frontend: `useSSE` alimenta state do dashboard. Remover `setInterval` polling.
- Fallback: se SSE desconectar por >60s, fazer fetch HTTP como backup.
- Reconexão automática já existe no hook (5s delay).

## 5. Migração Supabase `user_funnel_permissions`

- Verificar/rodar migração SQL existente.
- Criar tabela se não existir.

## 6. White Label — Script de Setup

- Criar `scripts/setup-whitelabel.sh` interativo.
- Pede: nome da marca, cores, subdomínio Kommo, Supabase URL/key, Gemini key.
- Automatiza: clone → gerar `.env` → criar tabelas Supabase → build → deploy Railway.
- Baseado no `docs/white-label-guide.md` existente.
