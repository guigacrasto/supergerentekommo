# WhatsApp — Aquecedor de Número + Disparos (Design)

**Data:** 2026-03-02

**Objetivo:** Duas telas novas para gestão de demandas WhatsApp — aquecimento de números e campanhas de disparo em massa. O sistema é **somente CRUD** (gestão de demandas). A execução real acontece em plataforma externa.

## Decisões de Arquitetura

- **Sem integração WhatsApp Cloud API** — o painel é apenas para passar demandas ao admin
- **Sem verificação de status WABA** — plataforma externa cuida disso
- **2 itens separados no sidebar** — `/warmer` e `/broadcasts`
- **Acesso:** Todos os usuários aprovados (não é admin-only)
- **Admin:** Vê dados de todos os usuários + pode aprovar/gerenciar campanhas
- **Stack:** Mesmo padrão do projeto (Supabase + Express + React)

## Modelo de Dados (Supabase)

### Tabela `warming_numbers`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| user_id | uuid FK profiles | Quem cadastrou |
| phone | text NOT NULL | Número no formato +55... |
| label | text | Apelido do número |
| status | text DEFAULT 'warming' | warming, ready, paused |
| days_active | int DEFAULT 0 | Dias desde o início do aquecimento |
| daily_limit | int DEFAULT 50 | Msgs/dia configuradas |
| created_at | timestamptz | |

### Tabela `campaigns`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| user_id | uuid FK profiles | Quem criou |
| name | text NOT NULL | Nome da campanha |
| template_name | text | Nome do template Meta |
| status | text DEFAULT 'pending' | pending → approved → sent |
| total_recipients | int DEFAULT 0 | Contagem de destinatários |
| approved_by | uuid FK profiles NULL | Admin que aprovou |
| approved_at | timestamptz NULL | |
| sent_at | timestamptz NULL | Quando foi marcada como enviada |
| created_at | timestamptz | |

### Tabela `campaign_recipients`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | uuid PK | |
| campaign_id | uuid FK campaigns | |
| phone | text NOT NULL | |
| name | text | Nome do contato |
| variables | jsonb | Variáveis do template |

## Fluxo de Uso

### Aquecedor

1. Usuário cadastra número (telefone + apelido + limite diário)
2. Tabela lista números com status (warming/ready/paused)
3. Admin vê todos os números de todos os usuários
4. Export CSV dos números

### Disparos (Campanhas)

1. Usuário cria campanha (nome + template)
2. Upload CSV com destinatários (phone, name, variáveis)
3. Status inicia como **pendente**
4. Admin revisa e **aprova** a campanha
5. Após envio na plataforma externa, admin marca como **enviado**

**Workflow de status:**
```
pendente → aprovado → enviado
```

## Rotas Backend

### Warming Numbers

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/warmer | Lista números do usuário (admin: todos) |
| POST | /api/warmer | Cadastra número |
| PATCH | /api/warmer/:id | Atualiza status/label/limite |
| DELETE | /api/warmer/:id | Remove número |
| GET | /api/warmer/export | Export CSV |

### Campaigns

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/broadcasts | Lista campanhas do usuário (admin: todas) |
| POST | /api/broadcasts | Cria campanha |
| POST | /api/broadcasts/:id/recipients | Upload destinatários (CSV parse) |
| GET | /api/broadcasts/:id/recipients | Lista destinatários |
| PATCH | /api/broadcasts/:id/approve | Admin aprova (status → approved) |
| PATCH | /api/broadcasts/:id/sent | Admin marca como enviado (status → sent) |
| DELETE | /api/broadcasts/:id | Remove campanha (só se pendente) |

## Telas Frontend

### `/warmer` — Aquecedor de Número

- **KPI cards no topo:** Total de números, Warming, Ready
- **Botão "Novo Número"** abre modal com form (telefone, apelido, limite)
- **Tabela:** Telefone, Apelido, Status (badge), Dias Ativo, Limite/dia, Ações
- **Admin:** Toggle para ver "Meus" vs "Todos"
- **Export CSV:** Botão no topo

### `/broadcasts` — Disparos

- **KPI cards no topo:** Total campanhas, Pendentes, Aprovadas, Enviadas
- **Botão "Nova Campanha"** abre modal com form (nome, template)
- **Tabela:** Nome, Template, Destinatários, Status (badge colorido), Data, Ações
- **Status badges:** Pendente (amarelo), Aprovado (azul), Enviado (verde)
- **Expandir linha:** Mostra lista de destinatários
- **Upload CSV:** Dentro da campanha expandida
- **Admin:** Botões "Aprovar" e "Marcar Enviado" visíveis por campanha
