# Fase 14 — Importação de fatura de cartão (CSV do C6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar a fatura de cartão do C6 em CSV (arquivo com um ou mais cartões, como `Fatura_AAAA-MM-DD.csv`) para contas de cartão de crédito, com parcelas, compras em dólar, categoria sugerida pela categoria do banco e conferência de duplicatas, alimentando o bloco "Cartões e faturas" do Painel.

**Architecture:** Um novo `StatementParser` em `packages/shared` (`c6CardInvoiceParser`, formato `csv_invoice`) entra no mesmo funil de detecção/preview/commit da Fase 11. Como o arquivo pode trazer vários cartões ("Final do Cartão"), o parser expõe `accountRefs` e o preview/commit rodam **por cartão** (parâmetro `cardRef`), um lote por cartão. O web percorre os cartões do arquivo um de cada vez reaproveitando a tela de preview. A categoria do banco vira sugestão de categoria nossa por uma tabela estática (`mapBankCategory`), gravada como `categorySource = import`; o que não mapeia segue para a categorização automática.

**Tech Stack:** TypeScript, Zod, Vitest, NestJS 11 + Prisma 7, Vue 3.5.

## Global Constraints

- O arquivo real de exemplo está em `~/Downloads/Fatura_2026-09-15.csv` (dados pessoais). **Nunca** copie linhas reais para o repositório, para logs ou para mensagens de erro; fixtures são mascaradas (nome do titular e comerciantes inventados). O teste de aceite contra o arquivo real usa `skipIf(!existsSync(...))` e **asserções booleanas** (uma falha não imprime dado real), como em `apps/api/test/e2e/import-real-statements.test.ts`.
- Formato do CSV (cabeçalho exato, separador `;`, decimais com ponto, datas `DD/MM/AAAA`, possível BOM e `\r\n`): `Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)`. Estrutura das linhas: compra em dólar (`US$` e cotação preenchidos, valor em R$ já convertido) precedida de uma linha de IOF (`US$ 0`, só R$), compra à vista com `Única`, pagamento com valor negativo (categoria `-`). O arquivo traz **mais de um cartão** (finais 1591 e 8074).
- Valor positivo em R$ = despesa; negativo = receita (crédito/pagamento/estorno). Linha com R$ 0 é ignorada. Valores sempre em centavos inteiros.
- Fingerprint: `importFingerprint(accountId, data, valorComSinal, descrição)` + ordinal (`ordinalFingerprints`), como nos demais parsers; o `accountId` é o do cartão, então cartões diferentes nunca colidem e reimportar a mesma fatura (ou outra que a sobreponha) não duplica.
- Mensagens de erro do parser **não incluem conteúdo de linhas** (só número da linha ou o nome da coluna) — o 422 vai ao usuário e nada vai para o log.
- A categoria do banco só sugere categorias `both` ou da entidade da conta (`categoryFits`), e só para despesas; `categorySource = "import"` com `categoryId` preenchido; sem mapeamento, a linha segue como `none` e entra na categorização da Fase 12.
- Parcelas: a descrição da linha ganha o sufixo ` n/m` quando a coluna `Parcela` for `n/m` ou `n de m` (o commit já extrai `installmentCurrent/Total` da descrição para contas `credit_card`, Fase 13). Compra em dólar: a descrição ganha o sufixo ` (US$ 5.00 @ 5.44)`.
- Português do Brasil em toda a interface e nas mensagens.
- Migrations geradas com `prisma migrate diff --from-schema <antigo> --to-schema ... --script`; drift check `prisma migrate diff --from-config-datasource --to-schema ...` deve dizer "No difference detected". O e2e da API usa o banco real e **não pode rodar em paralelo** com outro e2e ou com `pnpm dev`.

## Decisões

1. **Um lote por cartão.** O arquivo vira N previews/commits (um por final de cartão). Simples, desfazível por cartão, e reaproveita 100% do fluxo e do histórico de importações.
2. **Pagamento de fatura sem contrapartida.** Linha negativa cujo texto indica pagamento (`Pagamento …`, `Pgto … fatura`) é tratada pelo bloco de cartões como **pagamento** (não como estorno) mesmo sem par: `isCardPaymentText` em `@app/shared`, usado em `CardsService`. O pareamento automático da Fase 12 continua valendo quando a conta corrente também foi importada.
3. **Categoria do banco** vira sugestão por tabela estática (sem IA, sem custo); o que não casa vai para a categorização normal.
4. **Tipo de conta.** Fatura (CSV ou OFX de cartão) só importa para conta do tipo `credit_card`; a tela oferece criar o cartão na hora (nome, PF/PJ, fechamento, vencimento, limite).
5. **Fora de escopo:** fatura em PDF do C6 (sem exemplo), cartões de outros bancos, conferência do total da fatura (o CSV não traz o total), "Cotação" além de aparecer na descrição.

---

## File Structure

Criar:
- `packages/shared/src/parsers/csv-lite.ts` — leitor de CSV com `;`, aspas e BOM (Task 1)
- `packages/shared/src/parsers/c6-card-invoice.ts` — parser (Task 1)
- `packages/shared/src/parsers/bank-category.ts` — `mapBankCategory` (Task 1)
- `packages/shared/src/parsers/__fixtures__/c6-invoice-sample.ts` — fixture mascarada (Task 1)
- `packages/shared/src/__tests__/c6-card-invoice.test.ts`, `bank-category.test.ts`, `csv-lite.test.ts` (Task 1)
- `prisma/migrations/<timestamp>_fase14_csv_invoice/migration.sql` (Task 2)

Modificar: `packages/shared/src/parsers/{types,index}.ts`, `packages/shared/src/categorization.ts` (`isCardPaymentText`), `prisma/schema.prisma`, `apps/api/src/import/import-statement.service.ts` e `import.controller.ts`, `apps/api/src/dashboard/cards.service.ts`, `apps/web/src/lib/import-client.ts`, `apps/web/src/views/ImportView.vue`, `apps/api/test/e2e/import-real-statements.test.ts`, `README.md`.

---

### Task 1: Parser da fatura CSV do C6 (shared)

**Files:**
- Create: os arquivos de `packages/shared/src/parsers/` e testes listados acima
- Modify: `packages/shared/src/parsers/types.ts`, `packages/shared/src/parsers/index.ts`, `packages/shared/src/categorization.ts`, `packages/shared/src/__tests__/categorization.test.ts`

**Interfaces:**
- Produces:
  - `StatementFormat = "ofx" | "pdf_statement" | "csv_invoice"`
  - `DetectResult` ganha `accountRefs?: string[]` (finais de cartão distintos, na ordem em que aparecem; `accountRef` fica `null` quando houver mais de um)
  - `ParsedRow` ganha `bankCategory?: string | null` e `cardRef?: string | null`
  - `StatementParser.parse(text, ctx: { accountId: string; cardRef?: string | null })`; o parser da fatura com vários cartões e sem `cardRef` lança `StatementParseError("o arquivo tem mais de um cartão; escolha o final do cartão")`; `cardRef` que não existe no arquivo também lança `StatementParseError`
  - `c6CardInvoiceParser` (registrado em `STATEMENT_PARSERS`, exportado de `@app/shared`)
  - `readCsv(text: string, delimiter?: string): string[][]` (BOM removido, `\r\n`/`\n`, aspas com `""`, linhas vazias descartadas)
  - `mapBankCategory(bankCategory: string | null | undefined): string | null` → **nome** de categoria nossa (seed) ou `null`
  - `isCardPaymentText(text: string | null | undefined): boolean` em `categorization.ts` (casa `pgto fat…`, `pagamento (de) fatura`, `pag fatura` — o `CARD_PAYMENT` que já existe — **e** `^pagamento\b` após `foldText`)

- [x] **Step 1: Testes que falham** (escrever antes do código; mostrar a falha)
  - `csv-lite.test.ts`: BOM, `\r\n`, campo entre aspas com `;` dentro e `""`, linha vazia final, campo vazio no meio (`a;;c` → 3 colunas).
  - `c6-card-invoice.test.ts` com a fixture mascarada (mesma estrutura do arquivo real, nome `NOME TITULAR`, comerciantes inventados, **dois cartões** `1111` e `2222`, uma compra em dólar com linha de IOF antes, uma compra parcelada `3/10` e uma `2 de 6`, duas linhas idênticas no mesmo dia, um pagamento negativo, uma linha com R$ 0, categoria `-`):
    - `detect`: reconhece o cabeçalho (com e sem BOM, `\r\n`); `institution "c6"`, `kind "card_invoice"`, `format "csv_invoice"`, `confidence ≥ 0.9`, `accountRefs ["1111","2222"]`, `accountRef null`; com um único cartão `accountRef` preenchido; **não** reconhece um extrato do C6 em texto de PDF, um OFX, nem um CSV qualquer de outro formato (cabeçalho diferente).
    - `parse` sem `cardRef` e com 2 cartões → `StatementParseError` sem conteúdo de linha; com `cardRef` inexistente → erro; com `cardRef "1111"` só devolve as linhas desse cartão.
    - Valores: positivo → `expense`, negativo → `income` com `amountCents` positivo; linha com R$ 0 some; `date` em ISO; descrição com espaços colapsados; compra em dólar → descrição termina em ` (US$ 5.00 @ 5.44)`; `Parcela` `3/10` → descrição termina em ` 3/10` e `parseInstallment(descrição)` devolve `{3,10}`; `2 de 6` → ` 2/6`; `Única` → sem sufixo; `bankCategory` preenchida e `null` quando `-`; `cardRef` na linha; `period` = menor/maior data do cartão filtrado; `balances` vazio; `postedDate null`.
    - Fingerprints únicos mesmo com duas linhas idênticas (sufixo `|0` e `|1`) e estáveis entre duas execuções; trocar o `accountId` muda o fingerprint.
    - Data inválida (`31/02/2026`) ou valor não numérico → `StatementParseError` que cita só o número da linha (assert que a mensagem não contém a descrição).
    - Vírgula decimal (`1.234,56`) e ponto (`1234.56`) são aceitos (use `normalizeAmount` de `../ofx`).
  - `bank-category.test.ts`: tabela abaixo (insensível a caixa e acento, por trecho): `Restaurante / Lanchonete / Bar` → `Restaurantes e delivery`; `Supermercados / Mercearias` → `Supermercado`; `Assistência médica e odontológica` → `Saúde`; `Farmácias e drogarias` → `Farmácia`; `Serviços de telecomunicações` → `Contas e utilidades`; `TV por assinatura / Serviços de rádio` → `Assinaturas`; `Educacional` → `Educação`; `Combustível` / `Postos de gasolina` → `Combustível`; `Táxi / Transporte` / `Pedágio` / `Estacionamento` → `Transporte`; `Vestuário` / `Lojas de departamento` / `Eletrônicos` → `Compras`; `Entretenimento` / `Cinema` / `Hotéis` / `Companhias aéreas` / `Agências de viagem` → `Lazer`; `Veterinário` / `Pet shop` → `Pets`; `Impostos` → `Impostos e taxas`; `Elétrico` → `null` (é código de comerciante, não conta de luz); `-`, vazio e `null` → `null`; desconhecida → `null`.
  - `categorization.test.ts`: `isCardPaymentText("Pagamento CDB")`, `("PGTO FATURA C6")`, `("Pagamento de fatura")` verdadeiros; `("Pagamento de salário recebido")` também (começa com "pagamento" — documentar no teste que o contexto é conta de cartão); `("Amazon")`, `(null)` falsos.
- [x] **Step 2: Rodar e ver falhar** — `pnpm --filter @app/shared test`.
- [x] **Step 3: Implementar.**
  - `csv-lite.ts` máquina de estados simples (sem dependências).
  - Detecção: primeira linha não vazia, sem BOM, com `foldText`, igual a `data de compra;nome no cartao;final do cartao;categoria;descricao;parcela;valor (em us$);cotacao (em r$);valor (em r$)` (compare colunas, não a string crua, para tolerar espaços).
  - Parse: colunas por nome do cabeçalho (não por posição fixa), `ordinalFingerprints` sobre as linhas já filtradas por cartão e por valor ≠ 0, descrição = `descrição` colapsada + sufixo de parcela + sufixo de dólar (nessa ordem), `bankCategory` = coluna `Categoria` ou `null` se `-`/vazia.
  - `mapBankCategory`: lista ordenada de pares `[regex sobre foldText, nome]` (primeiro que casar vence).
  - Registrar o parser em `STATEMENT_PARSERS` e exportar tudo em `index.ts`; atualizar `StatementFormat`, `DetectResult`, `ParsedRow`, `StatementParser.parse` em `types.ts`. Os parsers existentes (`c6StatementParser`, `ofxStatementParser`) ignoram `cardRef`.
- [x] **Step 4: Rodar** — `pnpm --filter @app/shared test && pnpm --filter @app/shared typecheck && pnpm typecheck --force` (os outros pacotes consomem `StatementFormat`).
- [x] **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): parser da fatura CSV do C6, mapeamento de categorias do banco e isCardPaymentText"`

---

### Task 2: API — formato csv_invoice, detecção por cartão, preview com cartão e categoria sugerida, pagamentos na fatura

**Files:**
- Modify: `prisma/schema.prisma` (`enum ImportFormat` ganha `csv_invoice`), `apps/api/src/import/import-statement.service.ts`, `apps/api/src/import/import.controller.ts`, `apps/api/src/dashboard/cards.service.ts`
- Create: `prisma/migrations/<timestamp>_fase14_csv_invoice/migration.sql`
- Test: `apps/api/test/e2e/fatura-cartao.e2e.test.ts` (novo), `apps/api/test/e2e/import-real-statements.test.ts` (acrescentar o bloco da fatura real), `apps/api/test/database/schema.test.ts` se enumerar enums

**Interfaces:**
- Consumes: Task 1 (`detectStatement`, `c6CardInvoiceParser`, `mapBankCategory`, `isCardPaymentText`, `categoryFits`).
- Produces:
  - `POST /import/detect` → `DetectResponse` ganha `accountRefs: string[]` e `matchedAccounts: Record<string, string | null>` (por final de cartão: id da única conta ativa `credit_card` com esse `externalId`, senão `null`). Os campos antigos (`accountRef`, `matchedAccountId`) continuam como estão.
  - `POST /import/preview` aceita `format: "ofx" | "pdf_statement" | "csv_invoice"` e `cardRef?: string`; as linhas do preview ganham `categoryId: string | null` (sugestão pela tabela do banco, só despesas e só categorias do workspace que servem à entidade da conta) e `bankCategory: string | null`; `ImportBatch.format = csv_invoice` e `detectedAccountRef = cardRef`; arquivo de fatura (`kind = card_invoice`, CSV ou OFX de cartão) só importa para conta `credit_card` (400 `"este arquivo é uma fatura de cartão; escolha uma conta do tipo cartão de crédito"`); erros do parser continuam 422 com a mensagem.
  - `CardsService`: receita **sem par** cuja descrição satisfaz `isCardPaymentText` conta como **pagamento** (`paidCents`) e não reduz a fatura aberta como estorno.

- [x] **Step 1: Migration.** Copie o schema para o scratchpad, adicione `csv_invoice` ao `enum ImportFormat`, gere `migrate diff --script` (a saída deve ser só `ALTER TYPE "ImportFormat" ADD VALUE 'csv_invoice';`; remova a linha "Loaded Prisma config" se aparecer), aplique (`prisma migrate deploy`), confira o drift e regenere os clientes da API e do worker (veja os scripts `generate`).
- [x] **Step 2: Testes e2e que falham** (`fatura-cartao.e2e.test.ts`, mesmo setup de `integridade-importacao.e2e.test.ts`; use a fixture mascarada de dois cartões de `@app/shared`, exporte-a do pacote ou replique o texto no teste):
  - detect devolve `format "csv_invoice"`, `kind "card_invoice"`, `accountRefs ["1111","2222"]`, `matchedAccounts` com o id certo para a conta cujo `externalId` é `1111` e `null` para `2222`; duas contas ativas com o mesmo `externalId` → `null` para aquele final.
  - preview sem `cardRef` com dois cartões → 422; com `cardRef "1111"` e a conta certa → `rowCount` do cartão, `period`, `balanceCheck null`, linhas com `bankCategory` e `categoryId` preenchido quando a tabela mapeia e a categoria existe (criar `Restaurantes e delivery` de fábrica já vem no onboarding), `null` para `Elétrico` e para `-`; o lote fica com `format csv_invoice` e `detectedAccountRef "1111"`.
  - preview para conta que não é cartão → 400; para cartão PJ não sugere categoria exclusiva de PF (use uma categoria `entity pf` com o nome mapeado e uma conta PJ → `categoryId null`, ou a `both`).
  - commit do preview (envie `categoryId` das linhas) grava `categorySource "import"` nas linhas com categoria, `none` nas demais, `installmentCurrent/Total` nas linhas parceladas (3/10 e 2/6), e reimportar o mesmo arquivo para o mesmo cartão marca tudo como duplicata (`dupCount`) e não grava de novo; os dois cartões ficam em contas e lotes separados; `undo` de um lote não mexe no outro.
  - cartões (`GET /dashboard/cards`): receita sem par `"Pagamento CDB"` na conta do cartão aparece em `invoicePayments[].paidCents` do ciclo certo e **não** diminui `openInvoiceCents`; um estorno comum (`"Estorno Loja X"`) continua diminuindo a fatura.
  - bloco real em `import-real-statements.test.ts` (`skipIf` se `~/Downloads/Fatura_2026-09-15.csv` não existe; asserções booleanas): reconhecido como C6 `csv_invoice`; `accountRefs.length === 2`; parse de cada cartão sem erro; fingerprints únicos; total de linhas igual ao do arquivo menos as de R$ 0; ao menos uma linha de receita (o pagamento) e uma com sufixo de dólar.
- [x] **Step 3: Rodar e ver falhar** (e2e sozinho).
- [x] **Step 4: Implementar.** `detect`: depois de `detectStatement`, para `accountRefs` consultar contas ativas `credit_card` com `externalId in refs` agrupando por ref; só devolve o id quando há exatamente uma. `preview`: `cardRef` do corpo vai para `parse(text, { accountId, cardRef })`; checar tipo da conta quando `hit.detected.kind === "card_invoice"`; resolver sugestões: carregar as categorias do workspace (`type expense`), indexar por nome (`foldText`) e, para cada linha de despesa com `mapBankCategory(row.bankCategory)`, aceitar a categoria se `categoryFits` com a entidade da conta; devolver `categoryId`/`bankCategory` por linha. Não mude o contrato do commit (já aceita `categoryId`). `CardsService`: troque a condição "receita sem par = estorno" por "receita sem par e não `isCardPaymentText` = estorno; receita pareada ou `isCardPaymentText` = pagamento".
- [x] **Step 5: Rodar** — e2e sozinho e depois `pnpm --filter @app/api test` (uma vez), `pnpm typecheck --force`; atualizar contagens no README se listadas.
- [x] **Step 6: Commit** — `git add -A` (conferindo `git status`; nada de seed/scratch) `&& git commit -m "feat(api): importação da fatura CSV do C6 por cartão, categoria sugerida pelo banco e pagamentos na fatura"`

---

### Task 3: Web — fluxo de importação da fatura (um cartão por vez)

**Files:**
- Modify: `apps/web/src/lib/import-client.ts`, `apps/web/src/views/ImportView.vue`
- Test: `apps/web/src/lib/__tests__/import-client.test.ts` (estender), `apps/web/src/views/__tests__/import-invoice.test.ts` (novo, com `@vue/test-utils` e o `http` simulado como nos outros testes de view)

**Interfaces:**
- Consumes: Task 2 (`accountRefs`, `matchedAccounts`, `cardRef`, linhas com `categoryId`/`bankCategory`).
- Produces:
  - `import-client.ts`: `DetectedFormat` e `previewStatement` aceitam `"csv_invoice"`; `DetectResponse.accountRefs: string[]` e `matchedAccounts: Record<string,string|null>`; `PreviewRow` ganha `categoryId?: string | null` e `bankCategory?: string | null`; `previewStatement(body)` aceita `cardRef?`; helper puro `nextCardRef(accountRefs, doneRefs): string | null`.
  - `ImportView.vue`: arquivo `csv_invoice` abre o passo "confirm" para **o primeiro cartão ainda não importado**, mostrando "Cartão final 1591 (1 de 2)"; o seletor de conta lista só contas `credit_card` (a conta que casa por `externalId` vem selecionada) e há a opção **"Criar cartão"** com formulário inline (nome padrão `Cartão final XXXX`, PF/PJ, dia de fechamento, dia de vencimento, limite opcional) que cria a conta (`type credit_card`, `institution` do arquivo, `externalId` = final) e a seleciona; "lembrar conta" não é necessário aqui (a criação já grava o `externalId`). Depois de confirmar o preview daquele cartão, o commit envia também `categoryId` de cada linha; ao terminar, se ainda faltar cartão no arquivo, volta ao "confirm" do próximo ("Cartão final 8074 (2 de 2)") sem pedir o arquivo de novo; ao terminar o último, mostra o resumo ("2 cartões, N transações importadas"). A tabela de preview mostra uma coluna "Categoria do banco" e a nossa sugerida (nome da categoria quando houver `categoryId`) e marca parcelas e dólar pelo texto já presente na descrição.
  - `reset()` limpa a fila de cartões.

- [x] **Step 1: Testes que falham.**
  - `nextCardRef(["1111","2222"], [])` → `"1111"`; com `["1111"]` → `"2222"`; com ambos → `null`; lista vazia → `null`.
  - `previewStatement` envia `cardRef` e `format csv_invoice` (mock do `http`).
  - Teste de view: com `detectFile` simulado devolvendo `csv_invoice` e dois cartões, a tela mostra "final 1111 (1 de 2)", só lista contas de cartão, preseleciona a conta casada, "Criar cartão" chama `createAccount` com `type credit_card` e `externalId` e seleciona a nova conta, o commit envia `categoryId` das linhas, e após o commit do primeiro volta ao passo de confirmação do segundo cartão; após o segundo mostra o resumo. Um arquivo `ofx` continua indo direto ao fluxo antigo (sem fila).
- [x] **Step 2: Implementar** conforme as interfaces. Reutilize `finance.createAccount` e os componentes `ui/`. Textos pt-BR; botão desabilitado enquanto `busy`; erros do 422 aparecem como hoje.
- [x] **Step 3: Rodar** — `pnpm --filter @app/web test && pnpm --filter @app/web typecheck && pnpm --filter @app/web build`.
- [x] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): importar fatura do C6 em CSV, um cartão por vez, com criação de cartão e categoria sugerida"`

---

### Task 4: Verificação com o arquivo real e documentação

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-10-01-fase-14-fatura-cartao.md` (marcar passos)

- [x] **Step 1: Suítes completas, uma de cada vez** — `pnpm typecheck --force`, `pnpm test` (sem `pnpm dev` nem outro e2e), drift do Prisma.
- [x] **Step 2: Arquivo real, ponta a ponta** — subir API e web (launch.json local já existe: `api` e `web`), usar um usuário de teste novo, criar os dois cartões (finais `1591` e `8074`; fechamento/vencimento apenas de exemplo) pela tela "Importar" com `~/Downloads/Fatura_2026-09-15.csv`, conferir: 12 linhas no total entre os dois cartões (6 + 6); compra em dólar com sufixo `(US$ x @ cotação)`; o pagamento (valor negativo) aparece como receita no cartão que o traz e o Painel mostra como **pagamento** (não reduz a fatura aberta); a soma de cada cartão (despesas − créditos) bate com a soma das linhas do próprio arquivo (conferir com um script local, sem copiar valores para o repositório); categorias sugeridas (Restaurante → Restaurantes e delivery, Assistência médica → Saúde, telecom → Contas e utilidades, Netflix → Assinaturas, Educacional → Educação, Elétrico sem sugestão); reimportar o mesmo arquivo → tudo duplicado, zero novas; desfazer o lote de um cartão não apaga o outro. Conferir o bloco "Cartões e faturas" do Painel para esses cartões. Anotar discrepâncias no relatório em vez de "corrigir de cabeça". Remover o usuário de teste e parar os servidores.
- [x] **Step 3: Documentar** — README: contagens de testes reais, uma linha em "Importação de extratos" sobre a fatura CSV do C6 (vários cartões por arquivo, categoria do banco, parcelas e dólar), migrations: 14; marcar os passos deste plano.
- [x] **Step 4: Commit** — `git add README.md docs && git commit -m "docs: fecha a Fase 14 (plano marcado, README com fatura de cartão e contagens)"`
