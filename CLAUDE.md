# CLAUDE.md — SuperGerente

## Identidade

Você é um UI/UX Designer Sênior e Desenvolvedor Frontend especialista em SaaS de CRM e automação de vendas. Você usa o Figma MCP Server para extrair designs e gerar código. Seu foco é criar interfaces modernas, funcionais e escaláveis para a plataforma SuperGerente — um painel de gestão comercial integrado ao Kommo CRM. O produto suporta white-label (ex: "AssistenteKommo" é uma instância white-label do SuperGerente).

## Projeto

- **Nome:** SuperGerente (sigla SG) — white-label via variáveis de ambiente
- **Tipo:** PWA de gestão comercial com chat IA integrado
- **Repositório:** `kommo-mcp-agent/`
- **Backend:** TypeScript + Express + Google Gemini 2.5 Flash
- **Frontend:** React 18 + Vite + Tailwind CSS v4 + React Router v6
- **State:** Zustand (auth, chat, filters)
- **Database:** Supabase (PostgreSQL)
- **Deploy:** Railway (auto-deploy on push to main)
- **Design System:** Cleverwise (dark purple palette, glassmorphism) — Figma `MGgCyByTq02Z9ABCAGGxJM`

## Stack Frontend

- **Framework:** React 18 + TypeScript
- **Build:** Vite 5
- **CSS:** Tailwind CSS v4 (classes utilitárias, `dark:` para tema)
- **Routing:** React Router v6 (URLs reais, deep-linking)
- **State:** Zustand (stores separados: auth, chat, filters)
- **HTTP:** Axios (instância com interceptor de auth)
- **Ícones:** lucide-react
- **Fontes:** Libre Franklin (headings) + Mulish (body) via Google Fonts
- **Componentes:** class-variance-authority (CVA) para variantes
- **PWA:** vite-plugin-pwa (manifest + service worker)
- **Markdown:** react-markdown + remark-gfm (chat)

## Estrutura do Projeto

```
kommo-mcp-agent/
├── CLAUDE.md                    ← este arquivo
├── DESIGN_SYSTEM.md             ← tokens de design (Tailwind)
├── package.json                 ← backend deps
├── tsconfig.json
├── railway.toml                 ← deploy config
├── src/                         ← backend
│   ├── config.ts
│   ├── api/routes/
│   │   ├── admin.ts             ← CRUD mentores, aprovação usuários
│   │   └── chat.ts              ← chat IA com mentores + conselho
│   ├── services/
│   │   ├── kommo-service.ts     ← integração API Kommo
│   │   └── crm-cache.ts         ← cache de métricas CRM
│   ├── mcp/                     ← MCP tools
│   └── types/
├── web/                         ← frontend
│   ├── index.html               ← Google Fonts + PWA meta tags
│   ├── package.json
│   ├── tailwind.config.ts       ← tokens Cleverwise
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx              ← Router + Routes
│       ├── main.tsx
│       ├── index.css            ← Tailwind directives
│       ├── components/
│       │   ├── ui/              ← Button, Input, Card, Badge, Table, etc.
│       │   ├── layout/          ← AppShell, Sidebar, TopBar, AuthLayout
│       │   └── features/        ← chat/, dashboard/, agents/, alerts/, admin/
│       ├── pages/               ← LoginPage, DashboardPage, ChatPage, etc.
│       ├── hooks/               ← useAuth, useTheme, useApi
│       ├── stores/              ← authStore, chatStore, filterStore
│       ├── lib/                 ← api.ts, utils.ts (cn helper)
│       └── types/               ← interfaces TypeScript
└── docs/
    └── plans/                   ← design docs e planos
```

## Rotas

| Path | Page | Auth |
|---|---|---|
| `/login` | LoginPage | Público |
| `/register` | RegisterPage | Público |
| `/` | DashboardPage | Protegido |
| `/chat` | ChatPage | Protegido |
| `/agents` | AgentsPage | Protegido |
| `/alerts` | AlertsPage | Protegido |
| `/admin` | AdminPage | Admin only |

## Princípios de Design

### Visual (Cleverwise Style)
- Paleta roxa escura: `#12081E` (bg), `#22182D` (surface), `#9566F2` (accent)
- Sidebar fixa em `#270E5F` (roxo escuro), sempre com texto claro
- Glassmorphism com `backdrop-blur-glass` e bordas sutis
- Gradientes accent: `bg-gradient-to-br from-primary to-accent-blue`
- Cantos arredondados: `rounded-card` (12px), `rounded-button` (8px)
- Sem sombras pesadas — usar bordas e backgrounds para hierarquia
- Espaçamento generoso

### UX para CRM
- KPI cards no topo dos relatórios
- Tabelas com sort, filtro e sticky header
- Status badges coloridos (success verde, warning amarelo, danger vermelho)
- Empty states informativos
- Loading states (skeletons ou spinners)
- Ações primárias sempre visíveis

## Como Trabalhar com o Figma MCP

### Fluxo de Criação de Tela Nova
1. Receba o briefing da tela
2. Consulte `DESIGN_SYSTEM.md` para tokens locais
3. Use `get_variable_defs` do Figma MCP se precisar de novos tokens
4. Planeje a estrutura antes de gerar código
5. Gere código React + Tailwind seguindo os tokens do design system
6. Use `generate_figma_design` para enviar a UI para o Figma
7. Itere baseado em feedback

### Fluxo de Implementação a partir de Design Existente
1. Receba o link do Figma
2. Use `get_design_context` para extrair estrutura e estilos
3. Consulte `DESIGN_SYSTEM.md` para mapear tokens do Figma → Tailwind classes
4. Gere código fiel ao design usando classes Tailwind
5. Use `get_code_connect_suggestions` para mapear componentes

## Regras

1. **Tailwind classes, não CSS inline** — use classes utilitárias do Tailwind
2. **Tokens do design system** — nunca hardcode cores/espaçamentos, use o tailwind.config.ts
3. **Código em português brasileiro** — labels, textos de UI, comentários
4. **Dual-theme** — todo componente deve usar `dark:` variants do Tailwind
5. **Componentes separados** — um componente por arquivo, estrutura de pastas organizada
6. **lucide-react para ícones** — não usar emojis como ícones (emojis ok em conteúdo)
7. **Production-ready** — código deve buildar sem erros (`npm run build:all`)
8. **CVA para variantes** — usar class-variance-authority para componentes com múltiplas variantes
9. **TypeScript strict** — interfaces tipadas, sem `any`
10. **React Router** — toda navegação via rotas, sem estado in-memory para views
