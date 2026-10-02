# Revisão do sistema — 2026-10-02

Escopo: leitura integral de `apps/api/src`, `apps/worker/src`, `packages/shared/src`, infra (Dockerfile, CI, Vercel, Railway, Prisma) e do front (`apps/web/src`: libs, stores, rotas e todas as views). Typecheck dos 4 pacotes passou. Os testes e2e não foram executados (o Docker do projeto não estava de pé). Cada item traz arquivo:linha para ir direto ao ponto.

Severidade: **crítico** (dado vazando ou função quebrada em produção), **alto** (erro visível ao usuário ou risco real), **médio** (defeito latente, 500 evitável, inconsistência), **baixo** (acabamento).

---

## 1. Bugs

### Segurança e permissões

1. **Lista de membros de qualquer workspace** — crítico — `apps/api/src/workspaces/workspaces.controller.ts:22`. `GET /workspaces/:id/members` usa o `:id` da URL sem conferir se o usuário pertence a esse workspace. Qualquer usuário autenticado lista nome e e-mail dos membros de qualquer workspace cujo id conheça. Correção: resolver o workspace pelo guard (`x-workspace-id`) ou chamar `assertMembership(workspaceId, user.id)` no serviço antes de listar.

2. **Admin rebaixa o dono e pode deixar o workspace sem owner** — alto — `workspaces.service.ts:60-77`. `updateMemberRole` só exige owner/admin do chamador e só restringe a *promoção* a owner. Um admin pode rebaixar o único owner para `viewer`; `assertNotLastOwner` só roda no `removeMember`. O `role` do corpo também não é validado (`as any`): valor fora do enum vira erro 500 do Prisma. Mesmo problema em `addMember` (`:35`), que nem verifica se o `userId` existe.

3. **Convite pode conceder `owner` e aceita qualquer texto como e-mail** — alto — `invitations/invitations.service.ts:12-28`. `body.role` vai direto ao banco (`as never`): um admin convida um novo *owner*. `body.email` não é validado e vai para o Resend.

4. **Papel `viewer` não existe na prática** — médio — todo o `apps/api/src`. Só owner/admin têm regras (settings, convites, perfil PJ). `member` e `viewer` podem criar, importar, categorizar, apagar categorias e desfazer importações. A tela de Membros oferece "Leitor" como se fosse somente leitura.

5. **`storagePath` não é preso ao workspace** — médio — `ingest/ingest.service.ts:31-43`, `import/import.service.ts:210`. As chaves S3 são `${workspaceId}/${uuid}.${ext}`, mas `enqueueFile`/`enqueuePdf` aceitam qualquer caminho: um workspace pode mandar o worker processar um comprovante de outro. O UUID torna o palpite improvável, mas a checagem `startsWith(\`${workspaceId}/\`)` é barata. `ext` e `contentType` também não são validados (`:25`).

6. **Resposta do LLM renderizada como HTML** — médio — `apps/web/src/views/ChatView.vue:485,570`. `formatText` troca `\n` e `**` e o resultado vai em `v-html` sem escapar o texto. A resposta é persistida e re-renderizada em todo acesso: um `<img onerror>` vindo do modelo (ou de uma descrição de lançamento ecoada pela ferramenta) executa no navegador. Escapar HTML antes das substituições.

7. **Token de sessão no IndexedDB** — baixo — `apps/web/src/offline/write-queue.ts:26`. A fila offline grava `headers` (com o Bearer) em claro. Hoje ninguém enfileira nada; se não for usar, remover; se for, guardar só o corpo e montar os cabeçalhos no `flush`.

### Funcionalidades quebradas

8. **Previsão de fluxo de caixa dos Insights nunca é gravada** — crítico — `apps/worker/src/insights/cashflow.processor.ts:47,54`. O tipo `"cashflow_forecast"` não existe no enum `InsightType` (`spike, subscription, forecast, summary, budget_alert, goal_alert`). O `upsert` falha no Postgres, o job `compute_insights` termina `failed` sempre (os spikes e assinaturas gravados antes ficam; a previsão nunca aparece). Usar `forecast`, que já existe, e ajustar `InsightsView.vue:70,84,101`.

9. **Orçamento 50/30/20 não salva** — alto — `apps/web/src/views/BudgetsView.vue:33-35` envia `method` = `needs`/`wants`/`savings`; o enum `BudgetMethod` só aceita `fixed | fifty_thirty_twenty` → 500 do Prisma. Em `budgets/budgets.service.ts:78-92` o `status()` trata `needs`/`wants` que nunca existem e joga `fifty_thirty_twenty` no `else` (como poupança). Decidir um modelo: ou o enum ganha os três buckets, ou um orçamento `fifty_thirty_twenty` devolve três linhas calculadas.

10. **Recarregar a página desloga** — alto — `apps/web/src/stores/auth.ts:6`. O token vive só em memória; F5 volta ao login. O workspace ativo (`stores/workspace.ts:15`) também não persiste. Persistir o token (ou usar o cookie do Better Auth com `getSession` no boot) e salvar `activeId` no `localStorage`.

11. **Lembrete de conta a vencer aparece como "Orçamento undefined% utilizado"** — alto — `apps/worker/src/reminders/reminders.processor.ts:38-46` grava o lembrete com `type: "budget_alert"` e payload `{billId, name, amountCents, dueDate}`; `InsightsView.vue:82-86,99-100` lê `p.pct`, `p.spentCents`, `p.limitCents`. Criar um tipo próprio (`bill_due`) ou ao menos tratar o payload.

12. **"Posso gerenciar" na tela de Membros é verdadeiro para qualquer um** — médio — `MembersView.vue:149-152`. `canManage` procura *algum* membro owner/admin na lista (sempre existe) em vez de comparar com `auth.userId`. Leitores veem os controles e só recebem 403 ao clicar.

13. **Trocar de workspace não recarrega as telas** — médio — `stores/workspace.ts:27` só muda `activeId`; as views carregam dados em `onMounted` (ex.: `TransactionsView.vue:165`, `AccountsView.vue:787`). Só Ajustes observa a troca. O usuário vê os dados do workspace anterior até navegar. Um `watch(activeId)` global que reseta o `finance` store (ou `:key="activeId"` no `RouterView`) resolve.

14. **401 não encerra a sessão** — médio — `apps/web/src/lib/http.ts:51`. Com o token expirado todas as telas mostram "Unauthorized" genérico; nada redireciona ao login. Tratar 401 em um lugar só (limpar store e mostrar o `LoginView`).

### Validação de entrada (erros 500 evitáveis)

15. **Controllers sem schema** — médio. Zod cobre transações, contas, categorias, regras, review e import/detect, mas não:
    - `chat.controller.ts:17` (`message` ausente → `message.slice` lança);
    - `bills.controller.ts:16` (`any`; `BigInt(3.5)` e `new Date(undefined)` lançam);
    - `budgets.controller.ts:23`, `goals.controller.ts:18,33` (`BigInt` de decimal → `RangeError`; `amountCents` negativo aceito em contribuição);
    - `splits.controller.ts:16` (`userId` não precisa ser membro; cotas negativas);
    - `push.controller.ts:14` (`body.keys.p256dh` de `undefined`);
    - `ingest.controller.ts:13,21` e `import.controller.ts:59,91,105` (`csv` ausente derruba o Papa.parse; `format` do mapping livre);
    - `workspaces.controller.ts:18` (`name` vazio ou gigante; `currency` qualquer coisa).
    Um `ZodValidationPipe` global ou `schema.parse(body)` em cada rota, como já é feito nas demais.

### Correção de dados e dinheiro

16. **Commit de importação confia no cliente** — médio — `import/import.service.ts:66-186`. As linhas (valor, data, conta, fingerprint, categoria) vêm do navegador, não do preview guardado. Além disso o commit não exige `status = preview`: confirmar um lote já `committed` insere linhas novas (`:167` só checa `undoneAt`), e `rowCount`/`dupCount` ficam defasados. A `accountId` das linhas pode diferir da `accountId` do lote. Guardar as linhas do preview (ou um hash delas) e exigir `preview → committed`.

17. **Categoria pega-tudo identificada pelo nome** — médio — `packages/shared/src/categorization.ts:9-17`. Renomear "Outras despesas" em `PATCH /categories/:id` quebra a regra "a IA só sugere, nunca aplica". Um flag (`isCatchAll`) resolve.

18. **Trocar a entidade de conta ou categoria deixa lançamentos inconsistentes** — médio — `accounts.service.ts:62-69`, `categories.service.ts:33-46`. Uma conta PF com lançamentos em categoria "pj" pode virar PJ (e vice-versa) sem recategorizar nada; `categoryFits` passa a falhar só nas próximas edições.

19. **Fronteira de mês no fuso do servidor** — médio — `budgets.service.ts:64`, `worker/insights/compute.processor.ts:41,129`, `cashflow.processor.ts:20-21`. `DATE_TRUNC('month', NOW())` em UTC: entre 21h e 0h (BRT) o "mês atual" já é o seguinte. Os dashboards já recebem `asOf` do navegador; estes três ainda não.

20. **Orçamento e alerta ignoram subcategorias** — médio — `budgets.service.ts:80`, `dashboard/spending.service.ts:112-131`. `parentId` existe no modelo e nunca é usado: um orçamento em "Saúde" não soma "Farmácia" se um dia virar filha.

21. **Lotes `preview` acumulam para sempre** — baixo — `import-statement.service.ts:220`, `import.service.ts:50`. Cada preview (e cada arquivo do lote) cria um `ImportBatch` que nunca é confirmado nem limpo. Uma rotina que apaga previews com mais de 24 h.

22. **`detect` processa PDF na thread da API** — médio — `import-statement.service.ts:73-86`, `main.ts:17`. Até 20 MB em base64, `pdf-parse` síncrono no event loop e o texto inteiro volta ao cliente para ser reenviado no preview. Mover para o worker (já existe `parse_invoice`) ou ao menos guardar o texto no servidor por um token.

23. **Chat sem chave de API retorna 500 com o texto do OpenRouter** — baixo — `chat/chat.service.ts:11,44`. Sem `OPENROUTER_API_KEY` o erro deveria ser um 503 "chat não configurado". O histórico inteiro vai a cada mensagem (sem janela), e a mensagem do usuário só é gravada depois da resposta (`:48`): falha do modelo perde a pergunta.

24. **Remetente de e-mail fixo** — médio — `mail/mail.gateway.ts:36`. `noreply@sistema-financeiro.app` precisa estar verificado no Resend; sem isso o convite falha em produção e o 500 chega ao usuário. Ler de `MAIL_FROM`.

25. **Push: assinatura de outro usuário pode ser sobrescrita; expiradas nunca somem** — baixo — `push/push.controller.ts:15` (upsert por `endpoint` sem checar dono); `worker/push/push.gateway.ts:27` (410 não apaga a assinatura).

26. **`memberBalances` não compensa dívidas cruzadas** — baixo — `splits/splits.service.ts:28-38`. A deve 50 a B e B deve 30 a A aparecem como duas linhas, não como "A deve 20".

### Worker e parsers

27. **Ingestão manda dados pessoais ao LLM sem mascarar** — médio — `worker/src/ai/openrouter.ts:60,88`. A categorização usa `redactForLlm`; `parseText`, `parseImage` e `parseInvoiceText` não (CPF/CNPJ/contas do PDF vão inteiros).

28. **Imagem sempre `image/jpeg`, áudio sempre `webm`** — baixo — `ai/ingest.processor.ts:62,67`. PNG/HEIC do celular viram data URL com MIME errado; alguns modelos recusam. Guardar o `contentType` do upload no `AiJob.inputRef` ou ler o cabeçalho do objeto no S3.

29. **Gravação da categorização: um `updateMany` por linha dentro de 120 s** — médio — `ai/categorize.processor.ts:163-236`. Centenas de linhas = centenas de round-trips na mesma transação interativa. Agrupar por `categoryId` (`id: { in: [...] }`) reduz a dezenas.

30. **Pareamento de transferências nunca acontece "de fábrica"** — médio — `shared/src/categorization.ts:190`. Exige nome do titular (`ownerNames`, padrão vazio) ou texto de fatura. Até o usuário descobrir Ajustes, todo Pix entre contas próprias vira receita + despesa. Pedir os nomes no onboarding ou aceitar como sinal "ambas as contas são do workspace e importadas, mesmo valor, mesmo dia".

31. **CSV genérico sem validação por linha** — médio — `shared/src/import.ts:13-31`. `parseBrDate("32/13/2026")` → `"2026-13-32"`, `parseAmountCents("R$ 1,00")` → `NaN`. O preview mostra as linhas; o commit inteiro leva 400. Marcar erro por linha no preview.

32. **OFX não decodifica entidades** — baixo — `shared/src/ofx.ts:33`. `&amp;` fica literal na descrição.

33. **Regex de regras recompilada a cada lançamento** — baixo — `shared/src/rules.ts:13`. Pré-compilar por regra; e o ReDoS já conhecido continua aberto.

34. **Assinaturas agrupadas por `counterparty` sensível a caixa** — baixo — `worker/insights/compute.processor.ts:92`. "NETFLIX" e "Netflix" são duas assinaturas.

### Infra e build

35. **Produção roda TypeScript via swc/tsx com devDependencies** — médio — `Dockerfile`, `apps/api/package.json` (`start:prod`), `apps/worker/package.json`. Imagem de 1,4 GB; o worker usa `zod` (zod 4) e `tsx` declarados como devDependencies em runtime. Um `tsc`/`swc` build para `dist/` e `pnpm deploy --prod` cortam a imagem pela metade e removem a dependência frágil.

36. **Duas versões do Vite no monorepo** — baixo — `apps/web/package.json` fixa `vite ^5`, `@vitejs/plugin-vue ^5`, `jsdom ^26`; a raiz tem `vite ^8`, `plugin-vue ^6`, `jsdom ^29`. Alinhar.

37. **`tokens.css` carregado duas vezes** — baixo — `apps/web/index.html:7` e `main.ts:9`.

38. **CI com lista de branches antiga** — baixo — `.github/workflows/ci.yml:5` (fase-0 … fase-9). Trocar por `branches: ["**"]` ou só `main` + PR.

39. **Fila `system`/health do worker não é usada** — baixo — `worker/src/health.processor.ts`. A API pinga o Redis direto; código morto.

---

## 2. Backlog já registrado: situação

| Item | Situação |
|---|---|
| GET settings fazia upsert | **resolvido** (`workspace-settings.service.ts:17` só lê) |
| Paginar `GET /transactions`, `pending`, `findSimilar` | aberto |
| Pagamento de fatura como `transfer` não conta como pago | aberto (`cards.service.ts:70-79` documenta) |
| `vsBudget` filtrar por entidade da categoria | aberto |
| `Budget` sem unique (workspace, categoria) | aberto (upsert manual em `budgets.service.ts:16`) |
| `findMonorepoRoot` não pode lançar | aberto (`find-root.ts:10`) |
| `bodyLimit` só em `/import/detect` | aberto (global em `main.ts:17`) |
| Mascarar saída das tools do chat | aberto |
| ReDoS nas regras regex | aberto |
| Worker insights com `NOW()` | aberto |
| Job de categorização que falha deixa linhas fora da fila | **mitigado** (`pending-review.ts:20` recupera "esquecidas" após 15 min) |
| `try/finally` no destroy do PDF, shutdown hooks, `IngestJobData` no shared | **resolvidos** |
| `formatDate` com 1 dia a menos | **resolvido** (`date.ts:6`) |
| share_target POST do PWA | aberto (`SharedEntryView.vue:34` admite que não funciona) |
| `offline/` sem uso | aberto |

---

## 3. Melhorias (do óbvio ao ambicioso)

### Base (fazer antes de crescer)
- **Validação global**: `ZodValidationPipe` + schemas em `@app/shared` para todas as rotas; o front passa a importar os mesmos schemas (hoje duplica limites em `settings-client.ts` e `dashboard-client.ts`).
- **Autorização por papel em um só lugar**: decorator `@Roles("owner","admin")` e matriz de permissões; `viewer` passa a ser somente leitura de verdade.
- **Idempotência**: cabeçalho `Idempotency-Key` em `POST /transactions`, `commit` e `ingest` (a fila offline do PWA depende disso para não duplicar).
- **Paginação por cursor** em transações, com virtualização da lista no front.
- **Observabilidade**: logger do Fastify (pino) com `requestId`, Sentry no front e na API, métrica de custo de IA por workspace (`AiJob.costTokens` já existe; falta somar e mostrar).
- **Rate limit** em `/chat` e `/ingest` (custo de IA) com `@fastify/rate-limit`.
- **Testes de autorização**: um e2e que, com dois usuários, bate em cada rota com o workspace do outro e espera 401/403. Teria pegado o item 1.

### Produto
- **Regra com ensaio**: antes de salvar uma regra (ou aceitar "Criar regra" na fila), mostrar quantos lançamentos históricos ela pegaria e três exemplos. Evita as regras amplas que o backlog menciona.
- **Onboarding em três passos**: nomes do titular/empresa, primeira conta, primeiro extrato. Resolve o item 30 e o "pareamento nunca acontece".
- **Trilha de auditoria de categoria/par/ignorar** (`TransactionEvent`): permite "desfazer" por lançamento e explicar por que um número do painel mudou.
- **"Explique este número"**: cada card do Painel abre o chat já com o contexto (período, filtro, categoria). As ferramentas do chat já existem; falta o atalho.
- **Fechamento do mês**: no dia 1, um insight/push "Setembro fechou: PF gastou X, PJ Y, maior variação Z" com os dados que `summary` já calcula.
- **Cenários na previsão**: alternar "sem o cartão X", "com a reserva" e ver o saldo projetado mudar.
- **Hierarquia de categorias de verdade**: `parentId` existe; usar em orçamentos por grupo e no painel (drill-down).
- **Backup/restore completo** (hoje falta tags, splits, regras, contas agendadas e ajustes) e exportação por período.
- **Fila "Para categorizar" com teclado**: 1–9 para as categorias mais usadas do grupo, `i` ignorar, `t` transferência.

### Dívidas de modelo
- `Insight.type` precisa de `bill_due` e de usar `forecast`; `Budget` precisa decidir o modelo 50/30/20.
- `ImportBatch.status` deveria ter `undone` em vez de `committed + undoneAt`.
- `DraftStatus` só tem `draft | discarded`: rascunho confirmado vira `discarded` (`drafts.service.ts:62`); adicionar `confirmed`.
- Remover o `BigInt.prototype.toJSON = Number` global (`database.ts:8`) em favor de serialização explícita nos DTOs.
