# WhatsApp Health Monitor — Design

## Problema

Quando uma fonte WhatsApp desconecta do Kommo, leads param de entrar e ninguém é avisado. O sistema precisa monitorar proativamente e alertar os responsáveis.

## Solução

Serviço background que a cada 15 minutos verifica o status das fontes WhatsApp no Kommo. Se detectar desconexão, notifica via painel + email.

## Regras de Alerta

| Tipo de alerta | Destinatário | Canal |
|---|---|---|
| Fonte desconectou do Kommo | Usuário que cadastrou o número no SG | Notificação in-app + email |
| Erro de API/token/problema genérico | Admin (guilherme@onigroup.com.br) | Email + notificação in-app |
| Fonte reconectou | Usuário que cadastrou | Notificação in-app |

## Fluxo

```
[Cron 15min] → Busca whatsapp_numbers ativos por tenant
  → Para cada team, chama Kommo GET /api/v4/sources
  → Compara kommo_source_name cadastrado vs fontes reais
  → Se desconectou (e cooldown > 1h):
      1. Atualiza DB: connection_status='disconnected', disconnected_at=now
      2. Notificação in-app para user_id que cadastrou
      3. Email para o usuário com dados da conta e instrução de reconexão
      4. last_alert_at = now (cooldown 1h)
  → Se reconectou (estava disconnected):
      1. Atualiza DB: connection_status='connected', disconnected_at=null
      2. Notificação in-app: "WhatsApp X reconectado"
  → Se erro de API/token:
      → Email para guilherme@onigroup.com.br
```

## Schema — Novos campos em `whatsapp_numbers`

```sql
ALTER TABLE whatsapp_numbers
  ADD COLUMN IF NOT EXISTS kommo_source_id INTEGER,
  ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_alert_at TIMESTAMPTZ;
```

## Kommo API — GET /api/v4/sources

Retorna as fontes configuradas na conta. Cada source tem:
- `id` — ID da fonte
- `name` — Nome (ex: "WhatsApp - João")
- `external_id` — ID externo
- `pipeline_id` — Pipeline associado
- Campos de status de conexão

## Arquivos

| Arquivo | Ação |
|---|---|
| `src/services/whatsapp-health-monitor.ts` | NOVO — loop de verificação |
| `src/services/kommo.ts` | Adicionar `getSources()` |
| `src/api/services/email.ts` | Template `sendWhatsAppDisconnectedEmail()` |
| `src/api/index.ts` | Registrar setInterval 15min |
| `sql/010-whatsapp-health.sql` | Migration com novos campos |
| `web/src/pages/WhatsAppPage.tsx` | Coluna "Status Conexão" na tabela |

## Config

- `WHATSAPP_CHECK_INTERVAL_MS` — Intervalo de check (default: 900000 = 15min)
- `WHATSAPP_ALERT_COOLDOWN_MS` — Cooldown entre alertas (default: 3600000 = 1h)
- Admin fallback email: guilherme@onigroup.com.br
