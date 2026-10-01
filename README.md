# Sistema Financeiro IA

> Gestão financeira inteligente — monorepo full-stack com ingestão por IA, PWA offline e suporte a múltiplos workspaces (pessoal, família, PJ).

---

## Visão geral

O **Sistema Financeiro IA** é uma aplicação web progressiva (PWA) que permite registrar, categorizar e analisar despesas e receitas usando inteligência artificial. O usuário pode lançar transações por texto, áudio ou imagem; importar extratos OFX/PDF; e conversar com seus dados financeiros em linguagem natural via chat com function calling.

O projeto é um monorepo gerenciado com **pnpm workspaces + Turborepo**, composto por três aplicações e um pacote compartilhado.

---

## Stack

| Camada | Tecnologia |
|---|---|
| API REST | NestJS 11 + Fastify 5 |
| Banco de dados | PostgreSQL 16 + Prisma 7 (adapter `@prisma/adapter-pg`) |
| Autenticação | Better Auth 1.6 (e-mail/senha + sessões) |
| Fila de jobs | BullMQ 5 + Redis 7 |
| Object storage | MinIO (S3-compatible) |
| Frontend | Vue 3 + Vite 8 + Pinia + vue-i18n |
| PWA | vite-plugin-pwa + Workbox |
| IA — LLM | OpenRouter (OpenAI-compatible) |
| IA — STT | Groq Whisper |
| Gráficos | ECharts 6 |
| Validação | Zod 3 (`@app/shared`) |
| Testes | Vitest + `@nestjs/testing` |
| CI | GitHub Actions |

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│  apps/web   Vue 3 PWA (porta 5173)                  │
│  ┌──────┐ ┌───────┐ ┌──────┐ ┌──────┐ ┌────────┐  │
│  │ Auth │ │Finanç.│ │ Chat │ │ PWA  │ │Offline │  │
│  └──────┘ └───────┘ └──────┘ └──────┘ └────────┘  │
└───────────────────────┬─────────────────────────────┘
                        │ REST  /api/*
┌───────────────────────▼─────────────────────────────┐
│  apps/api   NestJS + Fastify (porta 3100)            │
│  accounts · transactions · ingest · chat · export   │
│  bills · budgets · goals · invitations · workspaces  │
└──────────┬──────────────────────────┬────────────────┘
           │ Prisma                   │ BullMQ
┌──────────▼──────┐        ┌──────────▼────────────────┐
│  PostgreSQL 16  │        │  apps/worker  BullMQ      │
│  (schema abaixo)│        │  ingest · insights · push  │
└─────────────────┘        │  import · reminders       │
                           └──────────┬────────────────┘
┌──────────────────────┐              │
│  MinIO (S3)          │◄─────────────┘
│  comprovantes/       │  upload de imagens/PDF
└──────────────────────┘
```

---

## Pré-requisitos

- **Node.js** ≥ 22
- **pnpm** ≥ 11 (`npm i -g pnpm`)
- **Docker** + **Docker Compose** (para PostgreSQL, Redis e MinIO)

---

## Quick start

```bash
# 1. clonar e instalar
git clone https://github.com/staeledson/Sistema-Financeiro.git
cd sistema-financeiro
pnpm install

# 2. subir infra local
docker compose up -d

# 3. configurar variáveis de ambiente
cp .env.example .env   # editar conforme necessário

# 4. aplicar migrations e gerar clientes Prisma
pnpm exec prisma migrate deploy
pnpm exec prisma generate

# 5. iniciar todos os apps em paralelo
pnpm dev
```

As portas foram escolhidas para não colidir com outras stacks locais (5432/6379/9000/3000 costumam estar ocupadas). Ajuste no `docker-compose.yml` e no `.env` se precisar.

Portas disponíveis após o `pnpm dev`:

| App | URL |
|---|---|
| Web (Vue PWA) | http://localhost:5173 |
| API (NestJS) | http://localhost:3100 |
| MinIO console | http://localhost:9011 |

---

## Estrutura do projeto

```
sistema-financeiro/
├── apps/
│   ├── api/                NestJS + Fastify
│   │   ├── src/
│   │   │   ├── accounts/   contas bancárias
│   │   │   ├── bills/      contas agendadas
│   │   │   ├── budgets/    orçamentos
│   │   │   ├── chat/       LLM + function calling
│   │   │   ├── export/     CSV, XLSX, JSON backup
│   │   │   ├── goals/      metas financeiras
│   │   │   ├── ingest/     lançamento por IA
│   │   │   ├── insights/   análises geradas
│   │   │   ├── push/       notificações push (VAPID)
│   │   │   ├── transactions/
│   │   │   └── workspaces/ multi-tenant
│   │   └── test/e2e/       263 testes de integração
│   │
│   ├── worker/             BullMQ job processors
│   │   └── src/
│   │       ├── ai/         ingestão (OCR, STT, LLM)
│   │       ├── import/     parsing OFX/PDF
│   │       ├── insights/   cashflow, categorização
│   │       └── reminders/  contas a vencer (cron)
│   │
│   └── web/                Vue 3 PWA
│       └── src/
│           ├── components/ 12 componentes (ui/, charts/, WorkspaceSwitcher, ChatChart…)
│           ├── offline/    cache IDB + write queue
│           ├── pwa/        install prompt
│           ├── stores/     auth, workspace, finance, theme
│           └── views/      17 views
│
├── packages/
│   └── shared/             Zod schemas + enums (isomórfico)
│
└── prisma/
    ├── schema.prisma       28 modelos
    └── migrations/         13 migrations
```

---

## Variáveis de ambiente

Crie um `.env` na raiz com as variáveis abaixo (todas as que têm padrão já funcionam com o `docker compose` padrão):

```dotenv
# Banco de dados
DATABASE_URL=postgresql://app:app@localhost:5433/financas

# Redis
REDIS_URL=redis://localhost:6380

# Autenticação
BETTER_AUTH_SECRET=troque-por-uma-chave-aleatoria-longa
BETTER_AUTH_URL=http://localhost:3100
PORT=3100

# OpenRouter (LLM — ingestão e chat)
OPENROUTER_API_KEY=

# Groq (Speech-to-Text)
GROQ_API_KEY=

# MinIO / S3
MINIO_ENDPOINT=http://localhost:9010
MINIO_ACCESS_KEY=minio
MINIO_SECRET_KEY=minio123
MINIO_BUCKET=financas

# Push notifications (VAPID) — opcional
# Gere com: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

---

## Testes

```bash
# todos os workspaces
pnpm test

# por app
pnpm --filter @app/shared test   # 270 testes unitários
pnpm --filter @app/api    test   # 263 testes e2e
pnpm --filter @app/worker test   # 61 testes unitários
pnpm --filter @app/web    test   # 207 testes unitários
```

O CI (GitHub Actions) executa PostgreSQL 16 + Redis 7 como services e roda o `turbo typecheck` e as quatro suítes de teste a cada push.

---

## Funcionalidades principais

- **Multi-workspace** — pessoal, família e PJ com isolamento completo por `workspaceId`
- **Ingestão por IA** — lançamento via texto, áudio (Groq Whisper) ou imagem (OCR)
- **Chat financeiro** — pergunte sobre saldos, gastos e fluxo de caixa em linguagem natural (function calling com guardrails de segurança)
- **Importação de extratos** — o arquivo é reconhecido sozinho (banco, tipo e conta): OFX de qualquer banco e extrato em PDF do C6 Bank (PF e PJ), com preview, marcação de duplicatas (períodos que se sobrepõem não duplicam), conferência dos saldos declarados no extrato, histórico de importações e desfazer. CSV por mapeamento manual; PDF de outros bancos via IA
- **Categorização automática e fila "Para categorizar"** — depois de importar, o sistema pareia transferências entre contas próprias (pelo nome do titular e da empresa, configuráveis, ou pelo pagamento de fatura), aplica regras e usa IA em lote com limiar de confiança (configurável por workspace); o que sobra vira uma fila de pendentes agrupados por descrição, onde uma decisão cria regra e vale para lançamentos parecidos. Receita e despesa ignoram transferências pareadas e lançamentos ignorados; o saldo de cada conta continua contando todos os movimentos
- **Painel, Início e Ajustes** — o Início resume saldos (PF, PJ e total), pendentes, próxima fatura e três gráficos; o Painel tem filtro global (todas/PF/PJ, conta e período: mês, trimestre, ano ou intervalo) guardado na URL e três blocos na ordem de prioridade: para onde vai o dinheiro (por categoria, evolução, orçamento, maiores destinos, recorrentes), cartões e faturas (fatura aberta, ciclo, parcelas, pagamentos) e fluxo de caixa (saldos, histórico de 12 meses e previsão de 3 meses). Os gráficos de categorias, orçamento e fluxo abrem a lista de transações já filtrada. Os endpoints `GET /dashboard/{spending,cards,cashflow,summary}` aceitam `entity`, `accountId`, `month|quarter|year|from+to` e `asOf` (data de referência, para testes). Em Ajustes ficam os nomes do titular/empresa, o limiar da IA e o tema; a lista de transações mostra os selos de transferência pareada, ignorado e parcela, com desfazer par e reativar
- **Regras de categorização** — automação baseada em padrões de descrição
- **Orçamentos e metas** — acompanhamento com progresso
- **Splits** — divisão de despesas entre participantes de um workspace
- **PWA offline** — cache de leitura + fila de escrita com sync automático ao reconectar
- **Push notifications** — lembretes de contas a vencer (VAPID)
- **Exportação** — CSV, XLSX (ExcelJS) e backup JSON completo
- **Share Target** — compartilhe um extrato ou comprovante direto do celular para lançar
- **Contas PF e PJ no mesmo workspace** — cada conta tem entidade (PF/PJ), instituição e, nos cartões, fechamento, vencimento e limite; categorias têm escopo PF/PJ/ambos e há filtro PF/PJ em contas e transações

### Regras de fatura e previsão

- **Ciclo da fatura**: as compras vão de `fechamento anterior + 1` até o dia de fechamento (`closingDay`, limitado ao último dia do mês). A fatura vence no `dueDay` do mês do fechamento se `dueDay > closingDay`; senão, no mês seguinte. A fatura aberta é despesas menos estornos (receitas não pareadas) do ciclo; o pagamento é a receita pareada na conta do cartão entre o fechamento e o seguinte. Cartão sem fechamento/vencimento aparece como não configurado.
- **Parcelas**: `n/m` da descrição vira `installmentCurrent/installmentTotal` só em contas de cartão de crédito (sem retroativo). A visão do cartão mostra as parcelas por **mês de vencimento** da fatura; a previsão de caixa conta as parcelas ainda não lançadas por **mês da data** do lançamento (o saldo e o histórico contam o gasto do cartão na data da compra).
- **Previsão de 3 meses** (`GET /dashboard/cashflow`): receita = média dos 6 meses fechados anteriores; despesa = parte variável (média das despesas − recorrentes − média das parcelas) + recorrentes detectadas + contas agendadas que não casam com uma recorrente + parcelas futuras ainda não lançadas. O saldo projetado parte do saldo atual do escopo. Aproximação conhecida: uma conta agendada que não casa por nome com uma recorrente pode contar em dobro com a média histórica.

---

## Modelos Prisma

`User` · `Session` · `Account` · `Verification` · `Workspace` · `WorkspaceMember` · `Invitation` · `BankAccount` · `Category` · `Tag` · `Transaction` · `TransactionTag` · `TransactionSplit` · `ImportBatch` · `ImportMapping` · `AiJob` · `TransactionDraft` · `CategoryRule` · `Insight` · `Budget` · `Goal` · `GoalContribution` · `BusinessProfile` · `ChatConversation` · `ChatMessage` · `PushSubscription` · `ScheduledBill` · `WorkspaceSettings`

---

## Licença

MIT © Stael Edson
