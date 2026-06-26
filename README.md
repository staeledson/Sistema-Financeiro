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
│  apps/api   NestJS + Fastify (porta 3000)            │
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

Portas disponíveis após o `pnpm dev`:

| App | URL |
|---|---|
| Web (Vue PWA) | http://localhost:5173 |
| API (NestJS) | http://localhost:3000 |
| MinIO console | http://localhost:9001 |

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
│   │   └── test/e2e/       72 testes de integração
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
│           ├── components/ WorkspaceSwitcher, ChatChart
│           ├── offline/    cache IDB + write queue
│           ├── pwa/        install prompt
│           ├── stores/     auth, workspace, finance
│           └── views/      14 views
│
├── packages/
│   └── shared/             Zod schemas + enums (isomórfico)
│
└── prisma/
    ├── schema.prisma       23 modelos
    └── migrations/         9 migrations
```

---

## Variáveis de ambiente

Crie um `.env` na raiz com as variáveis abaixo (todas as que têm padrão já funcionam com o `docker compose` padrão):

```dotenv
# Banco de dados
DATABASE_URL=postgresql://app:app@localhost:5432/financas

# Redis
REDIS_URL=redis://localhost:6379

# Autenticação
BETTER_AUTH_SECRET=troque-por-uma-chave-aleatoria-longa

# OpenRouter (LLM — ingestão e chat)
OPENROUTER_API_KEY=

# Groq (Speech-to-Text)
GROQ_API_KEY=

# MinIO / S3
MINIO_ENDPOINT=http://localhost:9000
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
pnpm --filter @app/api    test   # 72 testes e2e
pnpm --filter @app/worker test   # 17 testes unitários
pnpm --filter @app/web    test   #  9 testes unitários
```

O CI (GitHub Actions) executa PostgreSQL 16 + Redis 7 como services e roda os três suites a cada push.

---

## Funcionalidades principais

- **Multi-workspace** — pessoal, família e PJ com isolamento completo por `workspaceId`
- **Ingestão por IA** — lançamento via texto, áudio (Groq Whisper) ou imagem (OCR)
- **Chat financeiro** — pergunte sobre saldos, gastos e fluxo de caixa em linguagem natural (function calling com guardrails de segurança)
- **Importação de extratos** — OFX (bancos brasileiros) e PDF
- **Regras de categorização** — automação baseada em padrões de descrição
- **Orçamentos e metas** — acompanhamento com progresso
- **Splits** — divisão de despesas entre participantes de um workspace
- **PWA offline** — cache de leitura + fila de escrita com sync automático ao reconectar
- **Push notifications** — lembretes de contas a vencer (VAPID)
- **Exportação** — CSV, XLSX (ExcelJS) e backup JSON completo
- **Share Target** — compartilhe um extrato ou comprovante direto do celular para lançar

---

## Modelos Prisma

`User` · `Session` · `Account` · `Verification` · `Workspace` · `WorkspaceMember` · `Invitation` · `BankAccount` · `Category` · `Tag` · `Transaction` · `TransactionTag` · `TransactionSplit` · `ImportBatch` · `ImportMapping` · `AiJob` · `TransactionDraft` · `CategoryRule` · `Insight` · `Budget` · `Goal` · `GoalContribution` · `BusinessProfile` · `ChatConversation` · `ChatMessage` · `PushSubscription` · `ScheduledBill`

---

## Licença

MIT © Stael Edson
