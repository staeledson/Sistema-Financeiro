# Contas PF/PJ, importação com categorização por IA e dashboards — Design

**Data:** 2026-09-05
**Status:** aprovado pelo usuário em conversa; pronto para plano de implementação
**Escopo:** cinco fases sequenciais (saneamento, modelo PF/PJ, importação, categorização e fila manual, dashboards)

---

## 1. Contexto e diagnóstico

O sistema já possui workspaces, múltiplas contas, importação CSV/OFX/PDF, regras de categorização, fallback LLM, rascunhos, orçamentos, metas, chat e PWA. A revisão do código em 2026-09-05 encontrou os problemas abaixo, que a fase de saneamento corrige:

| # | Problema | Efeito |
|---|---|---|
| 1 | Portas 5432, 6379, 9000 e 3000 ocupadas por outra stack Docker (PluralMed) nesta máquina | `docker compose up` falha, migrations autenticam no banco errado, API não sobe |
| 2 | Cliente HTTP do front (`apps/web/src/lib/api.ts`) e as views Import/Review/Ingest não enviam `x-workspace-id` | Toda requisição cai no primeiro workspace do usuário |
| 3 | `POST /transactions/categorize` cria `AiJob` mas não enfileira; importação não dispara categorização | Categorização por IA nunca roda |
| 4 | Dashboard: API devolve `totalCents`, view lê `_sum.amountCents` | Quebra por categoria não aparece; nenhum gráfico apesar do ECharts instalado |
| 5 | Typecheck falha na API (papaparse sem tipos, caminho `../generated/prisma/enums`, ChartSpec vs Json, Buffer) e no worker (duas versões de ioredis) | CI não roda typecheck, erros passaram |
| 6 | Código de debug (logs em arquivo local e coletor `127.0.0.1:7546`) em controller e cliente; `.cursor/debug-*.log` e `.DS_Store` não ignorados | Sujeira e vazamento de caminho local |
| 7 | Worker `main.ts` não registra todos os processadores | Jobs de PDF/insights só rodam via `ingest` genérico |
| 8 | Saldo calculado carregando todas as transações em memória (`BalancesService`, chat `get_balance`) | Não escala |
| 9 | Fingerprint de import não distingue duas linhas iguais no mesmo dia | Pix repetidos (comuns no extrato PJ) seriam tratados como duplicata |

Mudanças não commitadas que ficam (entram no primeiro commit da fase 1): proxy do Vite, `load-env.ts` lendo `.env` da raiz, `auth-handler.ts` do Better Auth no Fastify, scripts `dev`, `.swcrc`, `BETTER_AUTH_URL` e `trustedOrigins`.

---

## 2. Decisões de produto (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Organização PF/PJ | **Um único workspace**; cada conta tem `entity: pf \| pj`; filtro por entidade em todas as telas. Categorias compartilhadas com escopo `pf \| pj \| both`. |
| 2 | Bancos | BB (OFX/CSV), Inter (OFX/CSV), C6 Bank (extrato e fatura em PDF, PF e PJ), Mercado Pago (somente PDF; via IA até haver arquivo de exemplo). |
| 3 | Importação | Importa e grava imediatamente; categorização é assíncrona por confiança (abordagem 1). |
| 4 | Limiar de confiança | 0,8 padrão, configurável por workspace. Lote de 40 transações por chamada ao LLM. |
| 5 | Prioridade dos dashboards | 1) Para onde vai o dinheiro; 2) Cartões e faturas; 3) Fluxo de caixa. "Saúde PJ" fora de escopo. |
| 6 | Visual | Novo, neutro e polido, modo claro e escuro. Sem vínculo com o design system PluralMed. |
| 7 | Portas locais | Postgres 5433, Redis 6380, MinIO 9010/9011, API 3100, Web 5173. |
| 8 | Execução | Cinco fases, cada uma com plano, branch e merge só com testes verdes. Subagentes de implementação com modelo mais barato; revisão com modelo mais confiável. |

Fora de escopo: Open Finance, saúde PJ, parser próprio do Mercado Pago, mudanças no chat.

---

## 3. Modelo de dados

Extensão do `prisma/schema.prisma` em uma migration nova. Nada existente muda de significado.

### 3.1 `BankAccount`

| Campo | Tipo | Regra |
|---|---|---|
| `entity` | enum `AccountEntity { pf, pj }` | Obrigatório. Migration preenche `pf` nas contas existentes. |
| `institution` | enum `Institution { bb, inter, mercado_pago, c6, other }` | Padrão `other`. Escolhe parser e logomarca. |
| `externalId` | `String?` | Número da conta ou final do cartão como aparece no extrato. Usado para reconhecer o arquivo. |
| `closingDay` | `Int?` (1–31) | Só cartão de crédito. Dia de fechamento. |
| `dueDay` | `Int?` (1–31) | Só cartão de crédito. Dia de vencimento. |
| `creditLimitCents` | `BigInt?` | Só cartão de crédito. |

Validação Zod em `packages/shared`: `closingDay`, `dueDay` e `creditLimitCents` só aceitos quando `type = credit_card`.

### 3.2 `Transaction`

| Campo | Tipo | Regra |
|---|---|---|
| `categorySource` | enum `CategorySource { manual, rule, ai, import, none }` | Padrão `none`. Transações existentes com categoria recebem `manual`. |
| `categoryConfidence` | `Float?` | 0–1, só quando `categorySource = ai`. |
| `reviewStatus` | enum `ReviewStatus { ok, pending }` | Padrão `ok`. A fila manual é `pending`. |
| `suggestedCategoryId` | `String?` (FK Category, SetNull) | Sugestão da IA guardada quando ficou pendente. |
| `transferPairId` | `String?` | Mesmo valor nas duas pernas de uma transferência interna detectada. Indexado. |
| `postedDate` | `DateTime? @db.Date` | Data contábil (C6). `date` continua sendo a data do lançamento. |
| `installmentCurrent` / `installmentTotal` | `Int?` / `Int?` | Extraídos de "n/m" na descrição da fatura. |
| `ignored` | `Boolean @default(false)` | Marcada "ignorar" na fila; sai de receita/despesa. |

Regra de agregação: receita e despesa **excluem** `transferPairId != null`, `type = transfer` e `ignored = true`, em todos os endpoints de dashboard e saldo.

### 3.3 `Category`

`entity: enum CategoryEntity { pf, pj, both } @default(both)`. Seed novo de categorias PJ (`entity = pj`): Pró-labore, Impostos e tributos, Fornecedores, Serviços contratados, Tarifas bancárias, Folha e terceiros, Receita de serviços (income). A tela lista categorias cujo `entity` seja `both` ou igual ao da conta da transação.

### 3.4 `ImportBatch`

| Campo | Tipo |
|---|---|
| `institution` | `Institution?` |
| `detectedAccountRef` | `String?` (o `externalId` lido do arquivo) |
| `balanceCheck` | `Json?` — `{ ok: boolean, expectedCents, computedCents, diffCents, checkedAt }` |
| `undoneAt` | `DateTime?` — lote desfeito |

`ImportFormat` ganha `pdf_statement` (extrato/fatura com parser determinístico) além de `csv`, `ofx`, `pdf` (IA).

### 3.5 `WorkspaceSettings` (novo, 1:1 com Workspace)

`aiConfidenceThreshold Float @default(0.8)`, `aiBatchSize Int @default(40)`, `transferMatchWindowDays Int @default(2)`, `ownerNames String[] @default([])` (nomes do titular e da empresa como aparecem nos extratos, usados na detecção de transferência interna).

### 3.6 Fingerprint de importação

Passa a ser `sha1(accountId | dateISO | signedAmountCents | normalizedDesc | ordinalNoDia)`, onde `ordinalNoDia` é a posição da linha entre as linhas idênticas do mesmo dia no arquivo (0, 1, 2…). OFX continua usando `ofx:{accountId}:{FITID}` quando houver FITID.

---

## 4. Importação

### 4.1 Fluxo

1. Usuário solta o arquivo na tela "Importar". Front lê o arquivo, envia para `POST /import/detect` (texto para OFX/CSV; para PDF, upload no MinIO e `storagePath`).
2. API extrai texto (pdftotext-equivalente via `pdf-parse`) e roda **detecção**: cada parser expõe `detect(text): { institution, kind: statement|card_invoice, accountRef?, confidence }`. Vence o de maior confiança; abaixo de 0,5 retorna `unknown`.
3. Se `accountRef` casa com `externalId` de uma conta ativa, a conta já vem selecionada. Se não, o usuário escolhe e pode salvar a associação (`PATCH /accounts/:id` com `externalId`).
4. `POST /import/preview` roda o parser escolhido, marca duplicatas por fingerprint, roda verificação de saldo (quando o arquivo traz saldos), detecta pares de transferência interna contra transações existentes, e cria `ImportBatch(status=preview)`.
5. `POST /import/:batchId/commit` grava as linhas selecionadas em uma transação de banco, marca lote `committed`, e enfileira `categorize` com `{ batchId }`.
6. `POST /import/:batchId/undo` apaga as transações do lote, limpa `transferPairId` das contrapartes e marca `undoneAt`.

### 4.2 Parsers (em `packages/shared/src/parsers/`)

Interface comum:

```ts
interface StatementParser {
  institution: Institution;
  detect(text: string): DetectResult | null;
  parse(text: string, ctx: { accountId: string }): ParsedStatement;
}
interface ParsedStatement {
  rows: ParsedRow[];           // type, amountCents, date, postedDate?, description, installment?, fingerprint
  balances?: { dateISO: string; balanceCents: number }[];  // "Saldo do dia"
  accountRef?: string;
  period?: { from: string; to: string };
}
```

| Parser | Fonte | Observações |
|---|---|---|
| `c6-statement` | PDF texto | Cabeçalho "Mês AAAA ( dd/mm/aaaa - dd/mm/aaaa )" fornece o ano. Linha: `dd/mm  dd/mm  Tipo  Descrição  [-]R$ 9.999,99`. Linhas "Saldo do dia dd/mm/aa  R$ x" alimentam `balances`. Mesmo layout PF e PJ. |
| `c6-card-invoice` | PDF texto | Mesmo motor; extrai `n/m` da descrição. Layout a confirmar com arquivo real. |
| `ofx` | OFX | Parser atual, corrigido: aceitar Latin-1, ler `BALAMT`/`DTASOF`, tolerar `<STMTTRN>` sem fechamento. |
| `csv-preset-bb`, `csv-preset-inter` | CSV | Presets de colunas, formato de data e sinal. Se nenhum preset casar, cai no mapeamento manual atual. |
| `ai-pdf` | PDF texto via LLM | Caminho atual de `parseInvoiceText`, mas gerando `ParsedRow[]` para o preview normal em vez de rascunhos. Usado para Mercado Pago e desconhecidos. |

Fixtures de teste: arquivos reais mascarados (nomes, CPF/CNPJ, números de conta) em `packages/shared/test/fixtures/`. Aceite: reimportar o mesmo arquivo insere zero linhas; `balanceCheck.ok = true` nos extratos C6 fornecidos.

### 4.3 Verificação de saldo

Para cada "Saldo do dia" do arquivo: saldo calculado = saldo do dia anterior no arquivo + soma das linhas do dia. Primeira ancoragem usa o primeiro saldo do arquivo. Diferença diferente de zero marca `balanceCheck.ok = false` e o preview exibe a diferença. Não bloqueia a importação.

### 4.4 Tela "Importar"

Uma zona única de soltar arquivo; card com banco detectado, tipo e conta; preview com colunas data, tipo, descrição, valor, marcação de duplicata, marcação de par de transferência; resultado do saldo; botão de confirmar. Abaixo, histórico de lotes (data, banco, conta, linhas, duplicadas, status) com ação "desfazer".

---

## 5. Categorização e fila manual

### 5.1 Job `categorize` (worker)

Entrada: `{ workspaceId, batchId? }`. Sem `batchId`, processa todas as `pending` e as `categorySource = none` do workspace.

1. **Transferências internas.** Candidatas: transações do escopo com `type in (income, expense)`, sem `transferPairId`. Par válido: contas diferentes do mesmo workspace, mesmo `amountCents`, tipos opostos, `|date1 - date2| <= transferMatchWindowDays`, e pelo menos um sinal textual: descrição contém nome do titular ou da empresa (cadastrados em `WorkspaceSettings.ownerNames[]`, preenchidos a partir dos extratos), ou casa com padrão de pagamento de fatura (`PGTO FAT CARTAO`, `PAGAMENTO FATURA`) quando uma das contas é `credit_card`. Pares recebem `transferPairId = cuid()` e `reviewStatus = ok`, saem dos passos seguintes.
2. **Regras.** `applyRules` atual sobre `counterparty + description`, filtrando regras cuja categoria seja compatível com a entidade da conta e com o tipo. Acerto: `categorySource = rule`, `categoryConfidence = 1`, `reviewStatus = ok`.
3. **IA em lote.** Grupos de `aiBatchSize`. Prompt: categorias válidas para a entidade com id e nome; até 30 exemplos recentes da mesma entidade (`categorySource in (manual, rule)`, descrições mais parecidas primeiro por trigramas); transações com id, descrição, valor, tipo, conta. `response_format` JSON schema: `{ results: [{ transactionId, categoryId | null, confidence }] }`. Validação Zod. Para cada resultado: `categoryId` válido para tipo/entidade e `confidence >= aiConfidenceThreshold` → aplica com `categorySource = ai`, `reviewStatus = ok`; caso contrário `reviewStatus = pending`, `suggestedCategoryId` preenchido se válido. Falha de rede ou JSON inválido: todo o grupo fica `pending`; job não falha. `AiJob.costTokens` acumula.

Saída em `AiJob.result`: `{ total, transfers, byRule, byAi, pending }`.

### 5.2 Endpoints

| Método | Rota | Função |
|---|---|---|
| `GET` | `/review/pending?entity&accountId&groupBy=description` | Grupos `{ key, description, count, totalCents, suggestedCategoryId, transactionIds[] }` |
| `POST` | `/review/categorize` | `{ transactionIds[], categoryId, createRule?: boolean (default true), applyToSimilar?: boolean }` → `manual` |
| `POST` | `/review/accept-suggestion` | `{ transactionIds[] }` → aplica `suggestedCategoryId` com `categorySource = ai` |
| `POST` | `/review/mark-transfer` | `{ transactionId, counterpartTransactionId }` |
| `POST` | `/review/unpair` | `{ transferPairId }` |
| `POST` | `/review/ignore` | `{ transactionIds[] }` → `ignored = true`, `ok` |
| `POST` | `/review/recategorize` | Enfileira `categorize` sem `batchId` |
| `PATCH` | `/transactions/:id/category` | Atual, mais `applyToSimilar` e resposta `{ similarCount }` |
| `GET/DELETE` | `/category-rules` | Atual, `GET` passa a incluir `hitCount` |
| `GET/PATCH` | `/workspaces/current/settings` | Limiar e nomes do titular |

### 5.3 Tela "Para categorizar"

Substitui a aba "Revisar". Seções: **Pendentes de categoria** (grupos por descrição normalizada, contagem, soma, sugestão da IA com botão aceitar, seletor de categoria para o grupo, ações marcar transferência e ignorar; filtros PF/PJ e conta) e **Rascunhos** (texto, foto, voz, comportamento atual). Cabeçalho com contador de pendentes e botão "Recategorizar pendentes".

### 5.4 Tela "Regras"

Lista padrão, tipo de casamento, categoria, prioridade, acertos; excluir. Acessível de dentro de "Para categorizar".

---

## 6. Dashboards

### 6.1 Filtro global

`entity (pf|pj|all)`, `accountId?`, `period` (`month=YYYY-MM` | `quarter` | `year` | `from/to`). Persistido na URL. Todos os endpoints de dashboard aceitam os mesmos parâmetros.

### 6.2 Endpoints (agregação em SQL, via Prisma `groupBy` ou `$queryRaw`)

| Rota | Retorno |
|---|---|
| `GET /dashboard/spending` | `byCategory[]` (categoria, total, %, count), `byMonth[]` (12 meses × top-6 categorias + outras), `vsBudget[]` (categoria, limite, realizado, %), `topCounterparties[]` (top 15), `recurring[]` (descrição normalizada, valor médio, intervalo em dias, ocorrências, total mensal estimado) |
| `GET /dashboard/cards` | por cartão: `openInvoiceCents`, `closingDate`, `dueDate`, `limitUsedPct`, `cycleDaily[]` (acumulado por dia do ciclo atual e média dos 3 anteriores), `installmentsAhead[]` (12 meses), `invoicePayments[]` (fatura fechada × pagamento casado) |
| `GET /dashboard/cashflow` | `balances[]` por conta com entidade e `consolidated` (PF, PJ, total), `monthly[]` (12 meses: receita, despesa, saldo acumulado), `forecast[]` (3 meses: média móvel de 6 meses de receitas e despesas não-recorrentes + recorrentes detectadas + `ScheduledBill` + parcelas futuras) |
| `GET /dashboard/summary` | Saldo consolidado, pendentes de categorização, próxima fatura a vencer, 3 séries principais do bloco 1 |

Cálculo de saldo por conta passa a ser `openingBalance + SUM(CASE …)` em SQL, reutilizado por `BalancesService` e pelo tool `get_balance` do chat.

Recorrência: agrupa por descrição normalizada (minúsculas, sem dígitos, sem espaços duplicados); é recorrente se tiver ≥ 3 ocorrências, desvio de valor ≤ 15% e intervalo médio entre 25 e 35 dias (mensal) ou 6 e 8 dias (semanal).

### 6.3 Telas

- **Início:** resumo (`/dashboard/summary`) com cartões de saldo, pendentes, próxima fatura e 3 gráficos.
- **Painel:** filtro global, três blocos na ordem de prioridade. Cada gráfico é um card com título, valor de destaque, insight de uma linha (ex.: "Supermercado subiu 18% vs. mês anterior") e clique abrindo a lista de transações filtrada. ECharts 6 com tema claro/escuro.

---

## 7. Saneamento e infraestrutura

- `docker-compose.yml`: Postgres `5433:5432`, Redis `6380:6379`, MinIO `9010:9000` e `9011:9001`, `container_name` com prefixo `financas-`. `.env.example` e `.env` seguem. API escuta `PORT` (padrão 3100). Proxy do Vite aponta para 3100. README atualizado.
- Typecheck: `@types/papaparse`; import de enums via `../../generated/prisma/enums` ou tipos do client; `chartSpec as Prisma.InputJsonValue`; `Buffer` cast; `pnpm.overrides` fixando `ioredis` em uma versão; anotações de retorno nos testes de chat. `turbo typecheck` entra no CI antes dos testes.
- Remover blocos `#region agent log`, `.cursor/debug-*.log`; `.gitignore` += `.cursor/`, `.DS_Store`, `.vite/`.
- `apps/web/src/lib/http.ts`: cliente único com `authorization`, `x-workspace-id` (do store), `content-type`, tratamento de erro com mensagem do corpo. `api.ts`, `ImportView`, `ReviewView`, `IngestView`, `workspace.ts` passam a usá-lo.
- `TransactionsService.enqueueCategorizationJob` enfileira de fato (injeta a mesma `Queue` do `IngestService`, extraída para `QueueModule`).
- `apps/worker/src/main.ts` registra explicitamente os processadores e o job `categorize` lê `batchId`.

---

## 8. Visual

Tokens em `apps/web/src/styles/tokens.css` ampliados: paleta neutra (cinzas quentes), cor de destaque única, semânticas `--c-income`, `--c-expense`, `--c-transfer`, `--c-pf`, `--c-pj`, modo claro e escuro via `prefers-color-scheme` e toggle manual. Fonte do sistema para texto, fonte tabular para números (`font-variant-numeric: tabular-nums`). Componentes base em `apps/web/src/components/ui/`: `Card`, `DataTable`, `EntityBadge`, `PeriodPicker`, `FilterBar`, `Money`, `EmptyState`. Navegação lateral no desktop, barra inferior no celular. `vue-router` com rotas `/`, `/painel`, `/contas`, `/transacoes`, `/importar`, `/categorizar`, `/regras`, `/orcamentos`, `/metas`, `/membros`, `/chat`, `/lancar`.

---

## 9. Testes

Padrão atual: Vitest, e2e da API com banco real (serial), unitários no worker e no shared.

| Área | Testes | Aceite |
|---|---|---|
| Parsers | Fixtures reais mascaradas por banco | Contagem de linhas, valores e datas esperados; reimport insere zero; `balanceCheck.ok` nos C6 |
| Transferência interna | Positivos (PF↔PJ, pagamento de fatura) e negativos (mesmo valor sem sinal textual, janela excedida) | Pares corretos, sem falso positivo |
| Job categorize | LLM mockado | Regra vence IA; confiança baixa vira pendente; JSON inválido não derruba; `AiJob.result` correto |
| Fila manual | e2e API | Categorizar grupo cria regra e aplica aos similares; aceitar sugestão; marcar/desfazer par; ignorar |
| Dashboards | Dados semeados, valores calculados à mão | Exclusão de transferências e ignoradas; filtro por entidade; fatura aberta e parcelas |
| Saneamento | `turbo typecheck` no CI | Verde nos três apps |

---

## 10. Fases de entrega

| Fase | Branch | Conteúdo | Pronto quando |
|---|---|---|---|
| 1 | `fase-9-saneamento` | Seção 7 inteira, mais correção do dashboard atual (`totalCents`) | `docker compose up`, migrations, `pnpm dev` e `turbo typecheck test` verdes |
| 2 | `fase-10-modelo-pf-pj` | Seções 3.1, 3.3, 3.5; tela de contas com entidade, instituição, dados de cartão; filtro PF/PJ em transações | Contas PF e PJ cadastradas e filtráveis |
| 3 | `fase-11-importacao` | Seção 4 e 3.4, 3.6 | Extratos C6 PF e PJ importados com saldo batendo; reimport não duplica |
| 4 | `fase-12-categorizacao` | Seção 5 e 3.2 | Job roda após import; pendentes na tela; categorizar grupo cria regra |
| 5 | `fase-13-dashboards` | Seções 6 e 8 | Três blocos funcionando com filtro global; visual novo aplicado em todas as telas |

Cada fase: `superpowers:writing-plans` → `superpowers:subagent-driven-development` (implementadores em modelo mais barato, revisores em modelo mais confiável) → `verification-before-completion` → merge em `main`.
