# Design: Automação de Remanejamento de Leads — Tenant GAME

**Data:** 2026-04-01
**Tenant:** GAME (`1e29dae5-38f2-4ac4-91c3-9189606f36b0`)
**Contas Kommo:** azul (`ferramentasempresa001`) + amarela (`iadeoperacoes`)
**Escopo:** Todos os funis de ambas as contas

---

## Objetivo

Automatizar o remanejamento de leads estagnados em etapas específicas, criando um novo lead na etapa `NEW LEADS 2` e fechando o antigo como venda perdida.

## Regras

| Regra | Etapa Azul | Etapa Amarelo | Dias corridos | Condição extra |
|-------|-----------|---------------|---------------|----------------|
| **R1** | `EM ATENDIMENTO` | `CLIENTE INTERESSADO` | 10 | Lead sem NENHUMA nota |
| **R2** | `N ATENDEU/ CX POSTAL /SEM RESPOSTA` | `n atendeu / cx postal / SEM RESPOSTA` | 15 | Nenhuma |

## Fluxo de Ação ("Remaneja")

Para cada lead que se enquadra em uma regra:

1. **Criar lead novo** na etapa `NEW LEADS 2` do **mesmo funil** com os mesmos dados (nome, contato, campos customizados, responsável)
2. **Adicionar nota** no lead antigo: `[SuperGerente] Lead remanejado automaticamente — Regra: {R1|R2} — Novo lead ID: {id}`
3. **Fechar lead antigo** como venda perdida (status_id: 143) com motivo `lead desqualificado` (buscar loss_reason_id por nome)

## Contagem de Dias

- **Base:** campo `status_changed_at` do lead no Kommo (timestamp de quando entrou na etapa atual)
- **Tipo:** dias corridos (inclui finais de semana)
- **Retroatividade:** NÃO. Só conta leads que entraram na etapa a partir do deploy desta automação

## Relatório por Email

- **Destino:** guilherme@onigroup.com.br
- **Envio:** Resend (mesmo provider do projeto)
- **Formato:** CSV anexado ao email
- **Assunto:** `[SuperGerente] Remanejamento automático — DD/MM/YYYY — X leads movidos`
- **Colunas do CSV:**
  - Data
  - Conta (azul/amarela)
  - Funil (nome do pipeline)
  - Lead Antigo ID
  - Lead Antigo Nome
  - Etapa Original
  - Regra Aplicada (R1 ou R2)
  - Lead Novo ID
  - Dias na Etapa
- **Se 0 leads movidos:** NÃO envia email

## Arquitetura

### Novo Serviço

`src/services/lead-remanejamento.ts`

- Função principal: `runLeadRemanejamento()`
- Chamada via timer no startup (`src/api/index.ts`)
- Frequência: 1x/dia às 4h BRT
- Para cada conta (azul, amarela):
  - Para cada pipeline (via `getPipelines()`):
    - Identifica etapas-alvo por nome (case-insensitive)
    - Busca leads nessas etapas
    - Filtra por `status_changed_at` (>10 ou >15 dias)
    - Para R1: verifica notas (getLeadNotes) — se tem 0 notas → remaneja
    - Para R2: remaneja direto
    - Acumula resultados para CSV

### Rate Limiting

- Máximo 5 operações paralelas (padrão do projeto)
- Delay entre batches para respeitar limites da API Kommo

### Logging

- Prefixo: `[LeadRemanejamento]`
- Log de cada lead processado (ID, funil, regra, resultado)
- Log de erros com contexto (lead ID, conta, funil)

### Padrões Seguidos

- Mesmo padrão do `daily-backup.ts` (timer + email CSV)
- Mesmo padrão do `activity-cache.ts` (DDD Proibido — fechamento automático + nota)
- Multi-team via `TEAMS.azul` / `TEAMS.amarela`

## Mapeamento de Etapas

```typescript
const STAGE_RULES = {
  azul: {
    R1: { stageName: 'EM ATENDIMENTO', days: 10, requiresNoNotes: true },
    R2: { stageName: 'N ATENDEU/ CX POSTAL /SEM RESPOSTA', days: 15, requiresNoNotes: false },
  },
  amarela: {
    R1: { stageName: 'CLIENTE INTERESSADO', days: 10, requiresNoNotes: true },
    R2: { stageName: 'n atendeu / cx postal / SEM RESPOSTA', days: 15, requiresNoNotes: false },
  },
};
```

## Dependências

- Kommo API (leads, pipelines, notes, loss_reasons)
- Resend (email com CSV)
- Nenhuma tabela nova no Supabase
