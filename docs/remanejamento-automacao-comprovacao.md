# Automacao de Remanejamento de Leads — Comprovacao

**Data:** 01/04/2026
**Sistema:** SuperGerente
**Tenant:** GAME (Kommo azul + amarela)
**Desenvolvido por:** SuperGerente AI

---

## 1. Visao Geral

O SuperGerente monitora diariamente todos os funis de ambas as contas Kommo (azul e amarela) e remaneja automaticamente leads estagnados, criando um novo lead na etapa "NEW LEADS 2" e fechando o antigo como venda perdida.

### Regras de Remanejamento

| Regra | Etapa Monitorada | Condicao | Acao |
|-------|-----------------|----------|------|
| **R1** | "EM ATENDIMENTO" (azul) / "CLIENTE INTERESSADO" (amarela) | 10+ dias na etapa **sem nenhuma nota** | Remanejar |
| **R2** | "N ATENDEU / CX POSTAL / SEM RESPOSTA" (ambas) | 15+ dias na etapa | Remanejar |

### O que o Remanejamento Faz

1. **Cria lead novo** na etapa "NEW LEADS 2" do mesmo funil
2. **Vincula o contato** do lead antigo ao novo (telefone, email, dados)
3. **Copia tags e campos personalizados** do lead antigo
4. **Mantem o mesmo responsavel**
5. **Adiciona nota** no lead antigo com referencia ao novo
6. **Fecha lead antigo** como "Venda perdida" (motivo: "Nao satisfeito com as condicoes")

### Execucao

- **Frequencia:** 1x por dia as 4h BRT (automatico)
- **Email:** Relatorio CSV enviado para guilherme@onigroup.com.br
- **Data de corte:** So processa leads que entraram na etapa a partir de 01/04/2026

---

## 2. Contas e Funis Monitorados

### Kommo AZUL (ferramentasempresa001)
- FUNIL PLUS
- FUNIL CRYPTOSENSE
- FUNIL TRYVION
- FUNIL NEW MATRIZ
- FUNIL AXION

### Kommo AMARELA (iadeoperacoes)
- Funil de vendas
- Funil de Vendas - Vectora

**Criterio:** Apenas funis que contem a etapa "NEW LEADS 2" sao processados.

---

## 3. Teste Real — Rodada 2 (Teste Final com Contatos)

**Data:** 01/04/2026 22:40 BRT
**Resultado:** 10/10 OK — todos com contatos vinculados

### AZUL

| # | Funil | Regra | Lead Antigo | Nome | Tel | Lead Novo | Contatos |
|---|-------|-------|-------------|------|-----|-----------|----------|
| 1 | FUNIL PLUS | R1 | 32717988 | Felipe machado da silva | +5515997408197 | **41360138** | 1/1 ✅ |
| 2 | FUNIL CRYPTOSENSE | R1 | 33840896 | Genivaldo Machado de Brito | +5563991129681 | **41360188** | 1/1 ✅ |
| 3 | FUNIL TRYVION | R1 | 32889044 | William de Godoi Oliveira | (67) 99626-1383 | **41360194** | 1/1 ✅ |
| 4 | FUNIL TRYVION | R2 | 41297996 | Noraelin lima | +55 (55) 99998-3987 | **41360200** | 1/1 ✅ |
| 5 | FUNIL NEW MATRIZ | R1 | 24877324 | Adao derli de Azevedo | +5551980557533 | **41360206** | 1/1 ✅ |
| 6 | FUNIL NEW MATRIZ | R2 | 41174484 | Lead #41174484 (Yago) | +5511984752698 | **41360208** | 1/1 ✅ |
| 7 | FUNIL AXION | R1 | 39696936 | Renato. Andre. Petry | +5551995579771 | **41360276** | 1/1 ✅ |
| 8 | FUNIL AXION | R2 | 35322280 | Julio Cesar | +5586999877182 | **41360282** | 1/1 ✅ |

### AMARELA

| # | Funil | Regra | Lead Antigo | Nome | Tel | Lead Novo | Contatos |
|---|-------|-------|-------------|------|-----|-----------|----------|
| 9 | Funil de vendas | R1 | 11572538 | Luigi | +5561999633521 | **26309099** | 1/1 ✅ |
| 10 | Funil de vendas | R2 | 9184080 | Alexandre Nascimento de Lima | +5582981603332 | **26309101** | 1/1 ✅ |

### Links de Verificacao

**Azul (ferramentasempresa001.kommo.com):**
- Lead novo #41360138: https://ferramentasempresa001.kommo.com/leads/detail/41360138
- Lead novo #41360188: https://ferramentasempresa001.kommo.com/leads/detail/41360188
- Lead novo #41360194: https://ferramentasempresa001.kommo.com/leads/detail/41360194
- Lead novo #41360200: https://ferramentasempresa001.kommo.com/leads/detail/41360200
- Lead novo #41360206: https://ferramentasempresa001.kommo.com/leads/detail/41360206
- Lead novo #41360208: https://ferramentasempresa001.kommo.com/leads/detail/41360208
- Lead novo #41360276: https://ferramentasempresa001.kommo.com/leads/detail/41360276
- Lead novo #41360282: https://ferramentasempresa001.kommo.com/leads/detail/41360282

**Amarela (iadeoperacoes.kommo.com):**
- Lead novo #26309099: https://iadeoperacoes.kommo.com/leads/detail/26309099
- Lead novo #26309101: https://iadeoperacoes.kommo.com/leads/detail/26309101

---

## 4. Fluxo Detalhado (Antes/Depois)

### Exemplo: Lead "Luigi" (#11572538 → #26309099)

**ANTES:**
- Lead ID: 11572538
- Pipeline: Funil de vendas (amarela)
- Etapa: "cliente interessado"
- Dias na etapa: 76 dias
- Notas: 0 (sem nota)
- Contato: Luigi | Tel: +5561999633521 | Email: lafungaia@yahoo.it
- Status: ATIVO

**DEPOIS:**
- Lead antigo #11572538:
  - Status: Venda perdida
  - Motivo: "Nao satisfeito com as condicoes"
  - Nota: "[SuperGerente] Lead remanejado automaticamente — R1 (10d sem nota) — 76 dias na etapa 'cliente interessado' — Novo lead ID: 26309099"
- Lead novo #26309099:
  - Pipeline: Funil de vendas (mesmo)
  - Etapa: NEW LEADS 2
  - Responsavel: Mesmo (ID 14465311)
  - Contato vinculado: Luigi (tel + email)
  - Tags copiadas: sim

---

## 5. Email de Relatorio

Apos cada execucao diaria, um email e enviado automaticamente para guilherme@onigroup.com.br contendo:

- **Assunto:** [SuperGerente] Remanejamento automatico — DD/MM/AAAA — X leads movidos
- **Corpo:** Resumo por conta (azul/amarela) + explicacao das regras
- **Anexo:** CSV com colunas: Data, Conta, Funil, Lead Antigo ID, Lead Antigo Nome, Etapa Original, Regra Aplicada, Lead Novo ID, Dias na Etapa

---

## 6. Configuracao Tecnica

- **Arquivo principal:** `src/services/lead-remanejamento.ts`
- **Startup:** Registrado em `src/api/index.ts` via `startLeadRemanejamento()`
- **Horario:** 4h BRT (7h UTC) — timer com setTimeout + setInterval 24h
- **Data de corte:** 01/04/2026 — leads que entraram nas etapas antes desta data sao ignorados
- **Loss reason:** "Nao satisfeito com as condicoes" (encontrado automaticamente)
- **Contatos:** Vinculados via `POST /leads/{id}/link` (endpoint Kommo)
- **Custom fields:** Copiados com fallback (se erro 400, tenta sem eles)
- **Rate limit:** 500ms delay entre operacoes
- **Deploy:** Railway (auto-deploy on push to main)

---

## 7. Bugs Corrigidos Durante Desenvolvimento

| Bug | Causa | Correcao |
|-----|-------|----------|
| Filtro de status ignorado | `paramsSerializer` usava `arrayFormat: 'brackets'` | Trocado para `arrayFormat: 'indices'` |
| Leads de pipeline errado | API retornava leads de outros pipelines | Adicionado `lead.pipeline_id !== pipeline.id` check |
| Contatos nao vinculados | `_embedded.contacts` na criacao nao funciona | Usar `POST /leads/{id}/link` apos criacao |
| Custom fields erro 400 | Campos de escolha invalidos em leads novos | Fallback: tentar sem custom_fields_values |
| Leads historicos processados | 25K+ leads antigos seriam movidos | Data de corte 01/04/2026 |
