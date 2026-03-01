# Guia de Deploy White-Label — SuperGerente

> Como duplicar e implantar o sistema SuperGerente para um novo cliente com branding próprio.
>
> **Tempo estimado:** ~1 hora

---

## Sumário

1. [Pré-requisitos](#1-pré-requisitos)
2. [Clonar o Repositório](#2-clonar-o-repositório)
3. [Configurar Supabase](#3-configurar-supabase)
4. [Configurar Kommo OAuth](#4-configurar-kommo-oauth)
5. [Configurar Branding](#5-configurar-branding)
6. [Deploy no Railway](#6-deploy-no-railway)
7. [Configurar Domínio](#7-configurar-domínio)
8. [Criar Primeiro Admin](#8-criar-primeiro-admin)
9. [Checklist Pós-Deploy](#9-checklist-pós-deploy)
10. [Manutenção](#10-manutenção)

---

## Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Railway                           │
│  ┌───────────────────────────────────────────────┐  │
│  │  Node.js (Express)                            │  │
│  │  ├── API REST (/api/*)                        │  │
│  │  ├── Chat IA (Google Gemini 2.5 Flash)        │  │
│  │  └── Frontend estático (React build)          │  │
│  └───────────────────────────────────────────────┘  │
└──────────┬──────────────────┬───────────────────────┘
           │                  │
           ▼                  ▼
    ┌─────────────┐   ┌──────────────┐
    │  Supabase   │   │  Kommo CRM   │
    │  (PostgreSQL│   │  (API REST)  │
    │  + Auth)    │   │              │
    └─────────────┘   └──────────────┘
```

O sistema é um monorepo com backend (Express) e frontend (React + Vite). O Railway faz o build de ambos e serve o frontend como arquivos estáticos pelo Express.

---

## 1. Pré-requisitos

Antes de começar, certifique-se de ter:

| Serviço | URL | Para quê |
|---|---|---|
| **GitHub** | https://github.com | Hospedar o código do cliente |
| **Railway** | https://railway.app | Deploy e hospedagem |
| **Supabase** | https://supabase.com | Banco de dados + autenticação |
| **Kommo CRM** | https://www.kommo.com | Conta do cliente (com acesso admin) |
| **Google AI Studio** | https://aistudio.google.com | Chave de API do Gemini |

**Requisitos técnicos locais (opcional, para testes):**

- Node.js >= 20
- npm >= 9
- Git

---

## 2. Clonar o Repositório

### 2.1. Criar repositório privado para o cliente

```bash
# Clonar o repo original
git clone https://github.com/SUA-ORG/kommo-mcp-agent.git cliente-nome

cd cliente-nome

# Remover o remote original
git remote remove origin

# Criar um novo repo privado no GitHub e apontar
git remote add origin https://github.com/SUA-ORG/cliente-nome.git
git push -u origin main
```

> **Importante:** Mantenha o repositório **privado**. Ele contém a lógica de negócio e os prompts dos mentores IA.

### 2.2. Verificar a estrutura

```
cliente-nome/
├── src/           ← backend (Express API)
├── web/           ← frontend (React + Vite)
├── .env.example   ← modelo de variáveis de ambiente
├── railway.toml   ← configuração do Railway
└── package.json   ← dependências do backend
```

---

## 3. Configurar Supabase

### 3.1. Criar projeto

1. Acesse https://supabase.com/dashboard
2. Clique em **New Project**
3. Escolha um nome (ex: `cliente-nome-prod`)
4. Selecione a região mais próxima do cliente (ex: `South America (São Paulo)`)
5. Defina uma senha forte para o banco de dados
6. Aguarde o provisionamento (~2 minutos)

### 3.2. Criar tabela `profiles`

Vá em **SQL Editor** e execute:

```sql
-- Tabela de perfis de usuários
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'denied')),
  role        TEXT        NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user', 'admin')),
  teams       TEXT[]      DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policy: usuários podem ver seu próprio perfil
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Policy: o service_role pode fazer tudo (usado pelo backend)
-- Não precisa criar — o service_role key já tem bypass de RLS.
```

### 3.3. Criar tabela `mentors`

Ainda no SQL Editor, execute:

```sql
-- Tabela de mentores (agentes IA)
CREATE TABLE IF NOT EXISTS mentors (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT          NOT NULL,
  description     TEXT,
  system_prompt   TEXT          NOT NULL DEFAULT '',
  methodology_text TEXT         DEFAULT '',
  is_active       BOOLEAN       DEFAULT TRUE,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);
```

### 3.4. Configurar autenticação

1. Vá em **Authentication** → **Providers**
2. Certifique-se de que **Email** está habilitado
3. Em **Authentication** → **URL Configuration**:
   - **Site URL:** `https://SEU-DOMINIO.com` (ou a URL do Railway por enquanto)
   - **Redirect URLs:** adicione `https://SEU-DOMINIO.com/**`

### 3.5. Copiar credenciais

Vá em **Settings** → **API** e anote:

- **Project URL** → será o `SUPABASE_URL`
- **service_role key** (a chave secreta, não a anon key) → será o `SUPABASE_SERVICE_KEY`

> **Atenção:** Use a **service_role key**, não a anon key. O backend precisa de permissões elevadas para gerenciar usuários.

---

## 4. Configurar Kommo OAuth

### 4.1. Criar integração no Kommo

1. Acesse a conta Kommo do cliente
2. Vá em **Configurações** → **Integrações** → **Criar integração**
3. Preencha:
   - **Nome:** Nome do sistema (ex: `SuperGerente - ClienteNome`)
   - **Redirect URI:** `https://SEU-DOMINIO.com/api/oauth/callback`
4. Anote:
   - **Client ID** → `KOMMO_CLIENT_ID`
   - **Client Secret** → `KOMMO_CLIENT_SECRET`

### 4.2. Obter access token inicial

O jeito mais rápido é usar o fluxo de autorização manual:

1. No painel da integração no Kommo, clique em **Instalar** na própria conta
2. Autorize o acesso
3. O Kommo vai redirecionar para seu redirect URI com um `code`
4. Use esse `code` para trocar pelo `access_token` (o sistema faz isso automaticamente se estiver rodando)

**Alternativa (direto pelo Kommo):**

Em algumas contas, o Kommo fornece um token de longa duração direto no painel da integração. Copie-o para `KOMMO_ACCESS_TOKEN`.

### 4.3. Variáveis do Kommo

```bash
KOMMO_SUBDOMAIN=subdominio-do-cliente    # ex: empresa (de empresa.kommo.com)
KOMMO_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx
KOMMO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
KOMMO_REDIRECT_URI=https://SEU-DOMINIO.com/api/oauth/callback
KOMMO_ACCESS_TOKEN=token-obtido-no-passo-anterior
```

### 4.4. Segunda equipe (opcional)

Se o cliente tiver **duas equipes** (azul e amarela) com contas Kommo separadas, repita o processo para a segunda conta e preencha:

```bash
KOMMO_AMARELA_SUBDOMAIN=subdominio-equipe-amarela
KOMMO_AMARELA_CLIENT_ID=...
KOMMO_AMARELA_CLIENT_SECRET=...
KOMMO_AMARELA_REDIRECT_URI=https://SEU-DOMINIO.com/api/oauth/callback
KOMMO_AMARELA_ACCESS_TOKEN=...
```

Se tiver **apenas uma equipe**, deixe essas variáveis vazias.

---

## 5. Configurar Branding

### 5.1. Variáveis de marca

Edite o `.env` (ou configure direto no Railway, passo 6) com o branding do cliente:

```bash
VITE_APP_NAME=NomeDoCliente
VITE_APP_SHORT_NAME=NC
VITE_APP_DESCRIPTION=Gestao comercial inteligente
VITE_APP_THEME_COLOR=#9566F2
```

| Variável | Onde aparece | Exemplo |
|---|---|---|
| `VITE_APP_NAME` | Título da página, header, login | `MegaVendas` |
| `VITE_APP_SHORT_NAME` | Badge do logo na sidebar | `MV` |
| `VITE_APP_DESCRIPTION` | Subtítulo na tela de login | `Gestão comercial inteligente` |
| `VITE_APP_THEME_COLOR` | Cor do PWA (barra do navegador mobile) | `#9566F2` |

### 5.2. Personalizar cores (opcional)

Para uma customização mais profunda, edite `web/tailwind.config.ts`:

```typescript
// web/tailwind.config.ts
colors: {
  primary: {
    DEFAULT: '#COR-PRINCIPAL',    // ex: #2563EB (azul)
    500: '#COR-PRINCIPAL',
    600: '#COR-HOVER',
    700: '#COR-ESCURA',
    900: '#COR-BACKGROUND',       // fundo geral no dark mode
  },
  sidebar: '#COR-SIDEBAR',        // fundo da barra lateral
  // ... demais cores
}
```

> **Dica:** Mantenha a paleta consistente. Use ferramentas como [Tailwind CSS Color Generator](https://uicolors.app/) para gerar variações a partir de uma cor base.

### 5.3. Substituir ícones do PWA (opcional)

Substitua os arquivos em `web/public/icons/` com o logo do cliente:

- `icon-192x192.png` — ícone 192x192px
- `icon-512x512.png` — ícone 512x512px

Use imagens quadradas com fundo transparente (PNG).

---

## 6. Deploy no Railway

### 6.1. Criar projeto

1. Acesse https://railway.app/dashboard
2. Clique em **New Project** → **Deploy from GitHub repo**
3. Conecte sua conta GitHub e selecione o repositório do cliente
4. O Railway vai detectar automaticamente o `railway.toml`

### 6.2. Adicionar variáveis de ambiente

No painel do projeto no Railway, vá em **Variables** e adicione **todas** as variáveis:

```bash
# BRANDING
VITE_APP_NAME=NomeDoCliente
VITE_APP_SHORT_NAME=NC
VITE_APP_DESCRIPTION=Gestao comercial inteligente
VITE_APP_THEME_COLOR=#9566F2

# KOMMO — Equipe Azul
KOMMO_SUBDOMAIN=subdominio
KOMMO_CLIENT_ID=seu-client-id
KOMMO_CLIENT_SECRET=seu-client-secret
KOMMO_REDIRECT_URI=https://SEU-DOMINIO.com/api/oauth/callback
KOMMO_ACCESS_TOKEN=seu-access-token

# KOMMO — Equipe Amarela (deixe vazio se não usar)
KOMMO_AMARELA_SUBDOMAIN=
KOMMO_AMARELA_CLIENT_ID=
KOMMO_AMARELA_CLIENT_SECRET=
KOMMO_AMARELA_REDIRECT_URI=
KOMMO_AMARELA_ACCESS_TOKEN=

# IA
GEMINI_API_KEY=sua-api-key-gemini

# SUPABASE
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_KEY=sua-service-role-key

# SERVER
PORT=3000
```

> **Importante:** As variáveis `VITE_*` são injetadas no **build do frontend**. Se alterar alguma variável `VITE_*`, é necessário fazer um **redeploy** para que o novo build reflita a mudança.

### 6.3. Verificar build

O Railway vai executar automaticamente:

```bash
npm run build:all
# Que faz:
# 1. npm install --prefix web    (instala deps do frontend)
# 2. npm run build --prefix web  (builda o React com Vite)
# 3. tsc                         (compila o backend TypeScript)
```

E depois:

```bash
npm start
# Que executa: node build/api/index.js
```

Acompanhe os logs no Railway para garantir que não há erros no build.

### 6.4. Testar com URL temporária

O Railway gera uma URL temporária (ex: `projeto-abc123.up.railway.app`). Use-a para testar antes de configurar o domínio final.

---

## 7. Configurar Domínio

### 7.1. Adicionar domínio no Railway

1. No Railway, vá em **Settings** → **Networking** → **Custom Domain**
2. Clique em **Add Domain**
3. Digite o domínio desejado (ex: `app.clientenome.com.br`)

### 7.2. Configurar DNS

No painel de DNS do domínio do cliente (Cloudflare, Registro.br, etc.), adicione:

| Tipo | Nome | Valor |
|---|---|---|
| `CNAME` | `app` | `projeto-abc123.up.railway.app` |

O valor exato será mostrado pelo Railway ao adicionar o domínio customizado.

### 7.3. SSL

O Railway configura SSL automaticamente via Let's Encrypt. Não é necessário nenhuma ação manual. O certificado é emitido em poucos minutos após a verificação do DNS.

### 7.4. Atualizar redirect URIs

Depois de configurar o domínio, atualize:

1. **Variável `KOMMO_REDIRECT_URI`** no Railway para `https://app.clientenome.com.br/api/oauth/callback`
2. **Redirect URI na integração do Kommo** para a mesma URL
3. **Site URL no Supabase** para `https://app.clientenome.com.br`

---

## 8. Criar Primeiro Admin

### 8.1. Registrar o primeiro usuário

1. Acesse a URL do sistema (domínio customizado ou URL do Railway)
2. Clique em **Criar conta**
3. Preencha nome, email e senha
4. O cadastro ficará com status `pending` (aguardando aprovação)

### 8.2. Aprovar e promover a admin

1. Acesse o **Supabase Dashboard** → **Table Editor** → tabela `profiles`
2. Encontre o registro do usuário recém-criado
3. Edite os campos:
   - `status`: altere de `pending` para `approved`
   - `role`: altere de `user` para `admin`
   - `teams`: defina as equipes, ex: `{azul}` ou `{azul,amarela}`
4. Salve

### 8.3. Testar acesso admin

1. Faça login com o usuário promovido
2. Verifique que o menu **Admin** aparece na sidebar
3. A partir de agora, este admin pode **aprovar outros usuários** diretamente pelo painel Admin do sistema

---

## 9. Checklist Pós-Deploy

Percorra cada item e confirme que funciona corretamente:

- [ ] **Login** — cadastro e login funcionam, redirecionamento para Dashboard
- [ ] **Dashboard** — KPIs carregam com dados reais do Kommo
- [ ] **Chat IA** — mentores respondem com contexto do CRM do cliente
- [ ] **Alertas** — leads abandonados e oportunidades atrasadas aparecem
- [ ] **Admin** — painel de aprovação de usuários e gestão de mentores
- [ ] **PWA** — sistema instala corretamente no celular (testar no Chrome mobile)
- [ ] **Branding** — nome, sigla e descrição mostram os dados do cliente
- [ ] **Domínio** — acessível pelo domínio customizado com HTTPS
- [ ] **Equipe Amarela** — se configurada, alterna entre equipes corretamente

---

## 10. Manutenção

### Tokens do Kommo

- Os tokens de acesso do Kommo **expiram periodicamente** e são renovados automaticamente pelo sistema
- Se o token expirar e a renovação falhar, será necessário refazer o fluxo OAuth (passo 4.2)
- Monitore os logs no Railway para erros de autenticação do Kommo

### Cache do CRM

- Os dados do Kommo são cacheados e **atualizados a cada 30 minutos**
- Para forçar uma atualização, reinicie o serviço no Railway (clique em **Restart**)

### Custos estimados

| Serviço | Custo | Observação |
|---|---|---|
| **Railway** | ~$5/mês | Por container (1 por cliente) |
| **Supabase** | Grátis | Até 50k requests/mês no plano Free |
| **Google Gemini** | ~$0-5/mês | Depende do volume de uso do chat |
| **Domínio** | ~$40/ano | Registro.br ou similar |

### Atualizações do sistema

Para aplicar atualizações do sistema base a uma instância do cliente:

```bash
# No repo do cliente
git remote add upstream https://github.com/SUA-ORG/kommo-mcp-agent.git
git fetch upstream
git merge upstream/main
# Resolva conflitos se houver
git push origin main
# O Railway faz o deploy automaticamente
```

### Backup

- O Supabase faz **backups automáticos diários** no plano Pro
- No plano Free, exporte manualmente: **Supabase Dashboard** → **Database** → **Backups**

### Monitoramento

- **Logs do Railway:** Railway → projeto → **Deployments** → clique no deploy → **View Logs**
- **Health check:** o sistema expõe `/health` que o Railway monitora automaticamente
- **Supabase:** monitore uso em **Settings** → **Usage**

---

## Referência Rápida de Variáveis

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_APP_NAME` | Sim | Nome do produto exibido na UI |
| `VITE_APP_SHORT_NAME` | Sim | Sigla exibida no badge do logo |
| `VITE_APP_DESCRIPTION` | Sim | Subtítulo na tela de login |
| `VITE_APP_THEME_COLOR` | Sim | Cor tema do PWA |
| `KOMMO_SUBDOMAIN` | Sim | Subdomínio da conta Kommo |
| `KOMMO_CLIENT_ID` | Sim | Client ID da integração |
| `KOMMO_CLIENT_SECRET` | Sim | Client Secret da integração |
| `KOMMO_REDIRECT_URI` | Sim | URI de callback OAuth |
| `KOMMO_ACCESS_TOKEN` | Sim | Token de acesso inicial |
| `KOMMO_AMARELA_*` | Não | Mesmos campos para 2ª equipe |
| `GEMINI_API_KEY` | Sim | Chave API do Google Gemini |
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Sim | Chave service_role do Supabase |
| `PORT` | Não | Porta do servidor (padrão: 3000) |
