# Design System — SuperGerente (Cleverwise)

## Cores

### Dark Theme (padrão)
- Background Primary: `#12081E` (fundo principal)
- Background Surface: `#22182D` (cards, painéis)
- Background Elevated: `#2F233C` (headers de tabela, hover)
- Sidebar: `#270E5F` (fixo em ambos os temas)
- Accent: `#9566F2` (roxo — cor principal de destaque)
- Accent Glow: `rgba(149, 102, 242, 0.1)`
- Accent Secondary: `#1F74EC` (azul — usado em gradientes)
- Text Primary: `#E0E3E9`
- Text Secondary: `#959CA6`
- Glass Border: `rgba(255,255,255,0.08)`
- Success: `#10b981`
- Warning: `#f59e0b`
- Danger: `#ef4444`

### Light Theme
- Background Primary: `#F4F5F7`
- Background Surface: `#FFFFFF`
- Background Elevated: `#EEF4FE`
- Sidebar: `#270E5F` (mesmo do dark)
- Text Primary: `#23272C`
- Text Secondary: `#645B6D`
- Glass Border: `rgba(0,0,0,0.08)`

## Tipografia

- **Font Headings:** Libre Franklin (500, 600, 700)
- **Font Body:** Mulish (400, 500, 600)
- **Import:** Google Fonts (`web/index.html`)

### Escalas
- H1: 1.5rem / 700 / Libre Franklin
- H2: 1.25rem / 600 / Libre Franklin
- H3: 1rem / 600 / Libre Franklin
- Body: 0.9rem / 400 / Mulish
- Caption: 0.8rem / 400 / Mulish
- Label Small: 0.7rem / 700 / uppercase / letter-spacing 0.05em

## Espaçamento

- xs: 0.25rem (4px)
- sm: 0.5rem (8px)
- md: 1rem (16px)
- lg: 1.5rem (24px)
- xl: 2rem (32px)
- 2xl: 2.5rem (40px)

## Border Radius

- sm: 0.4rem (6px) — inputs, badges
- md: 0.5rem (8px) — botões, logo
- lg: 0.75rem (12px) — cards (`.glass`)
- xl: 1rem (16px) — modais
- full: 20px — chips, pills

## Gradientes

- **Accent Gradient:** `linear-gradient(135deg, #9566F2, #1F74EC)` — botões primários, logo, chat bubble user
- **Radial BG:** `radial-gradient(circle at top right, rgba(149,102,242,0.03), transparent)` — fundo da content area
- **Auth BG:** `radial-gradient(circle at top right, rgba(149,102,242,0.08), transparent)` — fundo das páginas de auth

## Componentes Base

### Card (`.glass`)
```css
background: var(--bg-surface);
border: 1px solid var(--glass-border);
border-radius: 0.75rem;
```

### Botão Primário
```css
background: linear-gradient(135deg, #9566F2, #1F74EC);
color: white;
border: none;
border-radius: 8px;
padding: 0.75rem;
font-weight: 700;
```

### Botão Sidebar
```css
background: transparent;
border: none;
border-left: 3px solid transparent;
padding: 0.6rem 0.75rem;
color: rgba(224,227,233,0.7);
/* Active state: */
background: rgba(149,102,242,0.2);
border-left-color: #9566F2;
color: white;
```

### Input
```css
background: rgba(149,102,242,0.06);
border: 1px solid var(--glass-border);
border-radius: 8px;
padding: 0.75rem 1rem;
color: var(--text-primary);
/* Focus: */
border-color: var(--accent);
```

### Chip / Pill
```css
font-size: 0.8rem;
padding: 4px 12px;
border-radius: 20px;
border: 1px solid var(--glass-border);
background: transparent;
color: var(--text-secondary);
/* Active: */
background: var(--accent);
color: white;
border-color: var(--accent);
font-weight: 700;
```

### Badge
```css
font-size: 0.7rem;
font-weight: 700;
padding: 3px 10px;
border-radius: 20px;
/* Variants: */
.red    { background: rgba(239,68,68,0.2);  color: #f87171; }
.yellow { background: rgba(234,179,8,0.2);  color: #facc15; }
.orange { background: rgba(249,115,22,0.2); color: #fb923c; }
```

### Tabela
```css
th {
  padding: 1rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  position: sticky;
  top: 0;
  background: var(--bg-surface);
}
td {
  padding: 1rem;
  border-bottom: 1px solid var(--glass-border);
}
tr:hover td {
  background: rgba(149,102,242,0.03);
}
```

### Avatar
```css
width: 36px;
height: 36px;
border-radius: 50%;
background: linear-gradient(135deg, #9566F2, #1F74EC);
color: white;
font-size: 0.75rem;
font-weight: 700;
```

## CSS Variables (referência rápida)

```css
var(--bg-primary)      /* fundo principal */
var(--bg-surface)      /* cards, painéis */
var(--bg-elevated)     /* headers, hover states */
var(--sidebar-bg)      /* sidebar */
var(--accent)          /* cor principal de destaque */
var(--accent-glow)     /* glow sutil do accent */
var(--accent-secondary)/* azul para gradientes */
var(--text-primary)    /* texto principal */
var(--text-secondary)  /* texto secundário */
var(--glass-border)    /* bordas de glass cards */
var(--success)         /* verde */
var(--warning)         /* amarelo */
var(--danger)          /* vermelho */
```

## Ícones

Usar `lucide-react`. Ícones atualmente usados no projeto:
- `MessageSquare` — Chat
- `BarChart3` — Relatórios
- `PieChart` — Resumo
- `AlertTriangle` — Alertas
- `Settings` — Admin
- `LogOut` — Sair
- `Sun` / `Moon` — Toggle tema
- `Send` — Enviar mensagem
- `Filter` — Filtros
- `RefreshCw` — Atualizar
- `CheckCircle2` / `XCircle` — Aprovação/Rejeição
- `ChevronRight` / `ChevronDown` — Accordion
