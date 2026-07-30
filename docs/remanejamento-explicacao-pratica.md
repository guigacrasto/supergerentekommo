# Automação de Remanejamento de Leads

## O que faz?

A automação monitora todos os funis das duas contas Kommo (azul e amarela) e identifica leads "parados" — que estão numa etapa há tempo demais sem evolução. Quando encontra, ela:

1. Cria uma cópia do lead na etapa "NEW LEADS 2" (do mesmo funil)
2. A cópia vem com todos os dados: nome, contato, telefone, email, tags
3. O lead original é fechado como venda perdida com uma nota explicando o que aconteceu

Isso dá uma segunda chance ao lead — ele volta pro início do atendimento como se fosse novo.

---

## Regras (quando um lead é remanejado?)

### Regra R1 — Lead parado "Em Atendimento" sem nenhuma interação

- Azul: Etapa "EM ATENDIMENTO"
- Amarela: Etapa "CLIENTE INTERESSADO"
- Prazo: 10 dias corridos na etapa
- Condição extra: O vendedor não adicionou nenhuma nota no lead nesses 10 dias
- Se o vendedor adicionou pelo menos 1 nota, o lead não é remanejado (significa que está sendo trabalhado)

### Regra R2 — Lead sem contato há muito tempo

- Ambas as contas: Etapa "N ATENDEU / CX POSTAL / SEM RESPOSTA"
- Prazo: 15 dias corridos na etapa
- Sem condição extra — se ficou 15 dias nessa etapa, é remanejado independente de notas

---

## Quando roda?

- 1 vez por dia, às 4h da manhã (horário de Brasília)
- Roda automaticamente, sem precisar de ninguém
- Só considera leads que entraram nas etapas a partir de 01/04/2026 — o histórico antigo não é mexido

---

## Alerta por email

Toda vez que a automação roda (todo dia às 4h), ela envia um email para guilherme@onigroup.com.br com:

- Assunto: "[SuperGerente] Remanejamento automático — DD/MM/AAAA — X leads movidos"
- No corpo: Resumo de quantos leads foram movidos por conta (azul/amarela)
- Anexo: Planilha CSV com todas as informações:
  - Data
  - Conta (azul/amarela)
  - Funil
  - Lead antigo (ID + nome)
  - Etapa original onde estava parado
  - Regra aplicada (R1 ou R2)
  - Lead novo criado (ID)
  - Quantos dias ficou parado

Se nenhum lead for remanejado naquele dia, o email não é enviado (só recebe quando tem movimentação).

---

## Quais funis são monitorados?

Todos que têm a etapa "NEW LEADS 2". Hoje são:

Conta Azul:
- FUNIL PLUS
- FUNIL CRYPTOSENSE
- FUNIL TRYVION
- FUNIL NEW MATRIZ
- FUNIL AXION

Conta Amarela:
- Funil de vendas
- Funil de Vendas - Vectora

Se um funil novo for criado com a etapa "NEW LEADS 2", ele é incluído automaticamente.

---

## Resumo rápido

| Item | Detalhe |
|------|---------|
| R1 — Prazo | 10 dias sem nota |
| R1 — Etapa azul | EM ATENDIMENTO |
| R1 — Etapa amarela | CLIENTE INTERESSADO |
| R2 — Prazo | 15 dias |
| R2 — Etapa | N ATENDEU / CX POSTAL / SEM RESPOSTA |
| Horário | 4h da manhã (BRT), todos os dias |
| Email | guilherme@onigroup.com.br |
| Anexo | Planilha CSV com todos os leads movidos |
| Início | A partir de 01/04/2026 |
| Destino do lead novo | NEW LEADS 2 (mesmo funil) |
| Dados copiados | Nome, contato, telefone, email, tags |
| Lead antigo | Fechado como venda perdida + nota |
