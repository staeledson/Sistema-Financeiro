# Fase 0 — Fundação · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
>
> **Convenção deste plano:** scaffolding de framework (criar projeto Nest/Vite, instalar libs) é descrito por **comandos exatos**. Código autoral (Prisma schema, auth config, guards, testes) é mostrado por completo.

**Goal:** Levantar o monorepo com auth e-mail/senha (Better Auth), modelo `workspaces`/`workspace_members`, criação automática de workspace pessoal no signup e isolamento multi-tenant comprovado por testes — sem ainda lançar contas/transações.

**Architecture:** Monorepo pnpm+Turborepo. PostgreSQL 16 (Docker Compose local). Prisma como ORM + migrations. Better Auth para auth. API NestJS (Fastify). Workers BullMQ (Redis). Front Vue 3 PWA. Tipos/schemas Zod compartilhados em `packages/shared`.

**Tech Stack:** pnpm, Turborepo, TypeScript, Vitest, PostgreSQL 16, Prisma, Better Auth, NestJS+Fastify, BullMQ, Redis (ioredis), Vue 3, Vite, Pinia, vue-router, vue-i18n, vite-plugin-pwa, GitHub Actions.

## Global Constraints

- Dinheiro: inteiro em centavos + ISO 4217. Nunca float. (Relevante a partir da Fase 1.)
- Ledger: quase-double-entry — transferências com account_origem/account_destino, sem categoria.
- Moeda definida por workspace na criação (default `BRL`), imutável.
- TypeScript ponta a ponta; schemas Zod compartilhados em `packages/shared`.
- Toda tabela de domínio tem `workspaceId` e é filtrada por membership no service NestJS.
- Node 20+. pnpm. Vitest em todos os pacotes.
- PostgreSQL 16+ (requerido pelo `security_invoker` em views futuras, Fase 1).

---

## Mapa de arquivos

```
docker-compose.yml
pnpm-workspace.yaml
turbo.json
package.json
tsconfig.base.json
.github/workflows/ci.yml
prisma/
  schema.prisma
  migrations/
packages/
  config/
  shared/
apps/
  api/   (NestJS: AuthModule, WorkspacesModule, e2e tests)
  worker/ (BullMQ: fila system, job health.noop)
  web/   (Vue PWA: auth store Better Auth, login/signup, i18n, tokens)
```

---

## Task 1: Monorepo + tooling ✅ COMPLETO

Scaffold pnpm+Turborepo com `packages/config` e `packages/shared` (smoke test PING="pong").

---

## Task 2: `@app/shared` — enums e schemas Zod

**Files:**
- Create: `packages/shared/src/enums.ts`, `packages/shared/src/workspace.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/workspace.test.ts`

**Interfaces:**
- Produces: `WorkspaceType`, `MemberRole` (const arrays + types); `workspaceSchema`, `workspaceMemberSchema` (Zod) e tipos `Workspace`, `WorkspaceMember`. Consumidos por api (Task 5) e web (Task 8).

- [ ] **Step 1: Teste dos schemas (falha primeiro)**

`packages/shared/src/__tests__/workspace.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { workspaceSchema, WORKSPACE_TYPES, MEMBER_ROLES } from "../index";

describe("workspaceSchema", () => {
  it("aceita um workspace válido", () => {
    const ok = workspaceSchema.safeParse({
      id: "clwspc0001",
      type: "personal",
      name: "Pessoal",
      currency: "BRL",
      createdById: "clusr00001",
    });
    expect(ok.success).toBe(true);
  });

  it("rejeita type inválido", () => {
    const bad = workspaceSchema.safeParse({
      id: "clwspc0001",
      type: "invalid",
      name: "X",
      currency: "BRL",
      createdById: "clusr00001",
    });
    expect(bad.success).toBe(false);
  });

  it("rejeita currency fora de 3 letras", () => {
    const bad = workspaceSchema.safeParse({
      id: "clwspc0001",
      type: "personal",
      name: "X",
      currency: "BRLL",
      createdById: "clusr00001",
    });
    expect(bad.success).toBe(false);
  });

  it("expõe os enums esperados", () => {
    expect(WORKSPACE_TYPES).toEqual(["personal", "family", "business"]);
    expect(MEMBER_ROLES).toEqual(["owner", "admin", "member", "viewer"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd packages/shared && npx vitest run`
Expected: FAIL — exports `workspaceSchema`, `WORKSPACE_TYPES`, `MEMBER_ROLES` inexistentes.

- [ ] **Step 3: Enums**

`packages/shared/src/enums.ts`:
```ts
export const WORKSPACE_TYPES = ["personal", "family", "business"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
```

- [ ] **Step 4: Schemas**

`packages/shared/src/workspace.ts`:
```ts
import { z } from "zod";
import { WORKSPACE_TYPES, MEMBER_ROLES } from "./enums";

export const workspaceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(WORKSPACE_TYPES),
  name: z.string().min(1),
  currency: z.string().length(3).toUpperCase(),
  createdById: z.string().min(1),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceMemberSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(MEMBER_ROLES),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
```

- [ ] **Step 5: Reexportar**

`packages/shared/src/index.ts`:
```ts
export const PING = "pong";
export * from "./enums";
export * from "./workspace";
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd packages/shared && npx vitest run`
Expected: PASS (4 testes).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(shared): workspace enums and zod schemas"
```

---

## Task 3: Docker Compose + Prisma setup

**Files:**
- Create: `docker-compose.yml`
- Create: `prisma/schema.prisma`
- Create: `apps/api/package.json` (harness mínimo), `apps/api/vitest.config.ts`, `apps/api/test/helpers/db.ts`
- Test: `apps/api/test/database/schema.test.ts`

**Interfaces:**
- Produces: banco PostgreSQL 16 local; tabelas `workspaces`, `workspace_members` (+ tabelas do Better Auth: `user`, `session`, `account`, `verification`); Prisma client tipado. Consumidos pelas Tasks 4, 5, 6.

- [ ] **Step 1: Docker Compose**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: financas
    volumes:
      - postgres_data:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

Run: `docker compose up -d`

- [ ] **Step 2: Prisma init no repo root**

```bash
pnpm add -D -w prisma
pnpm add -w @prisma/client
npx prisma init --datasource-provider postgresql
```

Isso cria `prisma/schema.prisma` e `prisma/.env` (mover para `.env` na raiz ou usar `dotenv-cli`).

`.env` (na raiz):
```
DATABASE_URL="postgresql://app:app@localhost:5432/financas"
```

- [ ] **Step 3: Schema Prisma (falha — tabelas ainda não existem)**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// --- Better Auth tables ---

model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean
  image         String?
  createdAt     DateTime
  updatedAt     DateTime

  sessions     Session[]
  accounts     Account[]
  workspaces   Workspace[]       @relation("WorkspaceCreator")
  memberships  WorkspaceMember[]

  @@map("user")
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime

  @@map("account")
}

model Verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?

  @@map("verification")
}

// --- Domínio ---

enum WorkspaceType {
  personal
  family
  business
}

enum MemberRole {
  owner
  admin
  member
  viewer
}

model Workspace {
  id          String        @id @default(cuid())
  type        WorkspaceType
  name        String
  currency    String        @default("BRL") @db.Char(3)
  createdById String
  createdBy   User          @relation("WorkspaceCreator", fields: [createdById], references: [id], onDelete: Cascade)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  members WorkspaceMember[]

  @@map("workspaces")
}

model WorkspaceMember {
  id          String     @id @default(cuid())
  workspaceId String
  workspace   Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  userId      String
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        MemberRole
  createdAt   DateTime   @default(now())

  @@unique([workspaceId, userId])
  @@index([userId])
  @@index([workspaceId])
  @@map("workspace_members")
}
```

- [ ] **Step 4: Harness de teste de DB**

`apps/api/package.json` (mínimo):
```json
{
  "name": "@app/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": {
    "vitest": "^2.0.0",
    "dotenv": "^16.4.0"
  },
  "dependencies": {
    "@prisma/client": "*"
  }
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", hookTimeout: 30000, testTimeout: 30000 },
});
```

`apps/api/test/helpers/db.ts`:
```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function cleanDb() {
  await prisma.$transaction([
    prisma.workspaceMember.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.verification.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
```

`.env.test`:
```
DATABASE_URL=postgresql://app:app@localhost:5432/financas
```

- [ ] **Step 5: Teste de schema (falha primeiro)**

`apps/api/test/database/schema.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../helpers/db";

afterAll(async () => { await prisma.$disconnect(); });

describe("schema base", () => {
  it("workspaces existe", async () => {
    const count = await prisma.workspace.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("workspace_members existe", async () => {
    const count = await prisma.workspaceMember.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `cd apps/api && npx vitest run -- schema`
Expected: FAIL — tabelas não existem.

- [ ] **Step 7: Criar a migration e aplicar**

```bash
npx prisma migrate dev --name init
```

Isso aplica o schema ao banco e gera `prisma/migrations/TIMESTAMP_init/migration.sql`.

- [ ] **Step 8: Rodar e ver passar**

Run: `cd apps/api && npx vitest run -- schema`
Expected: PASS (2 testes).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(db): docker-compose postgres, prisma schema with workspaces and better-auth tables"
```

---

## Task 4: Better Auth + hook de onboarding

**Files:**
- Modify: `apps/api/package.json` (adicionar deps), criar `apps/api/src/lib/auth.ts`
- Test: `apps/api/test/database/onboarding.test.ts`

**Interfaces:**
- Consumes: Prisma client (Task 3).
- Produces: instância `auth` do Better Auth com email/password; hook `after.signUp` cria workspace pessoal + membership owner. Cenário T1.

- [ ] **Step 1: Instalar Better Auth**

```bash
cd apps/api
pnpm add better-auth @better-auth/cli
```

- [ ] **Step 2: Teste do onboarding (falha primeiro)**

`apps/api/test/database/onboarding.test.ts`:
```ts
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/lib/auth";

afterEach(() => cleanDb());
afterAll(() => prisma.$disconnect());

describe("onboarding", () => {
  it("T1: signup cria 1 workspace pessoal + 1 membership owner", async () => {
    const res = await auth.api.signUpEmail({
      body: {
        email: `test_${Date.now()}@example.com`,
        password: "Password123!",
        name: "Tester",
      },
    });
    expect(res.user).toBeDefined();

    const workspaces = await prisma.workspace.findMany({
      where: { createdById: res.user.id },
    });
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].type).toBe("personal");
    expect(workspaces[0].currency).toBe("BRL");

    const members = await prisma.workspaceMember.findMany({
      where: { userId: res.user.id },
    });
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    expect(members[0].workspaceId).toBe(workspaces[0].id);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd apps/api && npx vitest run -- onboarding`
Expected: FAIL — `auth` não existe ou workspace não é criado.

- [ ] **Step 4: Configurar Better Auth**

`apps/api/src/lib/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  hooks: {
    after: [
      {
        matcher: (ctx) => ctx.path === "/sign-up/email",
        handler: async (ctx) => {
          const userId = ctx.context.newSession?.userId;
          if (!userId) return;
          await prisma.$transaction(async (tx) => {
            const workspace = await tx.workspace.create({
              data: {
                type: "personal",
                name: "Pessoal",
                currency: "BRL",
                createdById: userId,
              },
            });
            await tx.workspaceMember.create({
              data: {
                workspaceId: workspace.id,
                userId,
                role: "owner",
              },
            });
          });
        },
      },
    ],
  },
});

export type Auth = typeof auth;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && npx vitest run -- onboarding`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(auth): better-auth email/password with personal workspace auto-creation on signup"
```

---

## Task 5: NestJS guards — isolamento ponta a ponta

**Files:**
- Create: scaffold NestJS em `apps/api/src/`, `apps/api/src/common/guards/current-user.guard.ts`, `apps/api/src/workspaces/workspaces.service.ts`, `apps/api/src/workspaces/workspaces.controller.ts`, `apps/api/src/workspaces/workspaces.module.ts`
- Test: `apps/api/test/e2e/workspaces.e2e.test.ts`

**Interfaces:**
- Consumes: Better Auth (Task 4); Prisma (Task 3); `Workspace` de `@app/shared`.
- Produces: `GET /workspaces` retorna apenas workspaces do caller; `POST /auth/*` proxy para Better Auth. Cenários T2, T3, T4.

- [ ] **Step 1: Scaffold NestJS**

```bash
cd apps/api
pnpm dlx @nestjs/cli@latest new . --skip-git --package-manager pnpm --strict
pnpm add @nestjs/platform-fastify @app/shared
pnpm add -D supertest @types/supertest @nestjs/testing
```

Ajustar `apps/api/package.json`: manter `name` = `@app/api`; conservar script `test` (vitest).

- [ ] **Step 2: Teste e2e de isolamento (falha primeiro)**

`apps/api/test/e2e/workspaces.e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { auth } from "../../src/lib/auth";
import { prisma, cleanDb } from "../helpers/db";

let app: NestFastifyApplication;

async function createUserAndToken(email: string) {
  const signup = await auth.api.signUpEmail({
    body: { email, password: "Password123!", name: "Tester" },
  });
  // sign in to get token
  const signin = await auth.api.signInEmail({
    body: { email, password: "Password123!" },
  });
  return { userId: signup.user.id, token: signin.token };
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await cleanDb();
  await app.close();
  await prisma.$disconnect();
});

describe("GET /workspaces", () => {
  it("T2: retorna só os workspaces do usuário autenticado (não os de outro)", async () => {
    const a = await createUserAndToken(`a_${Date.now()}@example.com`);
    const b = await createUserAndToken(`b_${Date.now()}@example.com`);

    const resA = await app.inject({
      method: "GET", url: "/workspaces",
      headers: { authorization: `Bearer ${a.token}` },
    });
    const resB = await app.inject({
      method: "GET", url: "/workspaces",
      headers: { authorization: `Bearer ${b.token}` },
    });

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    const bodyA = resA.json<{ id: string }[]>();
    const bodyB = resB.json<{ id: string }[]>();

    expect(bodyA).toHaveLength(1);
    expect(bodyB).toHaveLength(1);
    expect(bodyA[0].id).not.toBe(bodyB[0].id);
  });

  it("T4: 401 sem token", async () => {
    const res = await app.inject({ method: "GET", url: "/workspaces" });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Expected: FAIL — 404 (rota não existe).

- [ ] **Step 4: Guard CurrentUser**

`apps/api/src/common/guards/current-user.guard.ts`:
```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { auth } from "../../lib/auth";

@Injectable()
export class CurrentUserGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) throw new UnauthorizedException();

    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
    if (!session?.user) throw new UnauthorizedException();

    req.user = session.user;
    return true;
  }
}
```

- [ ] **Step 5: WorkspacesService**

`apps/api/src/workspaces/workspaces.service.ts`:
```ts
import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

@Injectable()
export class WorkspacesService {
  async listForUser(userId: string) {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    return memberships.map((m) => ({
      ...m.workspace,
      role: m.role,
    }));
  }
}
```

- [ ] **Step 6: WorkspacesController**

`apps/api/src/workspaces/workspaces.controller.ts`:
```ts
import { Controller, Get, Request, UseGuards } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service";
import { CurrentUserGuard } from "../common/guards/current-user.guard";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  @UseGuards(CurrentUserGuard)
  list(@Request() req: { user: { id: string } }) {
    return this.service.listForUser(req.user.id);
  }
}
```

- [ ] **Step 7: WorkspacesModule + AppModule**

`apps/api/src/workspaces/workspaces.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService] })
export class WorkspacesModule {}
```

Em `apps/api/src/app.module.ts`, importar `WorkspacesModule`.

- [ ] **Step 8: Rodar e ver passar**

Run: `cd apps/api && npx vitest run -- workspaces.e2e`
Expected: PASS (2 testes). Isolamento provado ponta a ponta (HTTP → NestJS guard → Better Auth session → Prisma query filtrada por userId).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(api): NestJS skeleton + CurrentUserGuard + GET /workspaces with per-user isolation"
```

---

## Task 6: Teste de isolamento T3 — usuário A não insere membership em workspace de B

**Files:**
- Test: `apps/api/test/e2e/workspace-isolation.e2e.test.ts`

**Interfaces:**
- Produces: prova que tentar inserir membership em workspace alheio retorna 403. Cenário T3.

- [ ] **Step 1: Teste (falha primeiro — rota não existe)**

`apps/api/test/e2e/workspace-isolation.e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { auth } from "../../src/lib/auth";
import { prisma, cleanDb } from "../helpers/db";

let app: NestFastifyApplication;

async function createUserAndToken(email: string) {
  await auth.api.signUpEmail({ body: { email, password: "Password123!", name: "T" } });
  const signin = await auth.api.signInEmail({ body: { email, password: "Password123!" } });
  return signin.token;
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => { await cleanDb(); await app.close(); await prisma.$disconnect(); });

describe("isolamento", () => {
  it("T3: POST /workspaces/:id/members retorna 403 quando usuário não é owner/admin", async () => {
    const tokenA = await createUserAndToken(`iso_a_${Date.now()}@example.com`);
    const tokenB = await createUserAndToken(`iso_b_${Date.now()}@example.com`);

    // pegar workspace de B
    const wsB = await app.inject({
      method: "GET", url: "/workspaces",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    const workspaceId = wsB.json<{ id: string }[]>()[0].id;

    // A tenta inserir membro no workspace de B
    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/members`,
      headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
      payload: { userId: "some-user-id", role: "member" },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL — 404 (rota não existe).

- [ ] **Step 3: Endpoint POST /workspaces/:id/members com verificação de ownership**

Adicionar ao `WorkspacesController`:
```ts
import { Body, Param, Post, ForbiddenException } from "@nestjs/common";

@Post(":id/members")
@UseGuards(CurrentUserGuard)
async addMember(
  @Param("id") workspaceId: string,
  @Body() body: { userId: string; role: string },
  @Request() req: { user: { id: string } }
) {
  return this.service.addMember(workspaceId, body.userId, body.role, req.user.id);
}
```

Adicionar ao `WorkspacesService`:
```ts
import { ForbiddenException } from "@nestjs/common";

async addMember(workspaceId: string, targetUserId: string, role: string, actorId: string) {
  const actorMembership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actorId } },
  });
  if (!actorMembership || !["owner", "admin"].includes(actorMembership.role)) {
    throw new ForbiddenException();
  }
  return prisma.workspaceMember.create({
    data: { workspaceId, userId: targetUserId, role: role as any },
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx vitest run -- isolation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): POST /workspaces/:id/members with owner/admin guard (T3 isolation)"
```

---

## Task 7: Worker BullMQ + job `health.noop`

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/vitest.config.ts`, `apps/worker/src/queue.ts`, `apps/worker/src/health.processor.ts`
- Test: `apps/worker/test/health.test.ts`

**Interfaces:**
- Produces: fila `system` com job `health.noop` processável. Cenário T5.

- [ ] **Step 1: Pacote do worker**

`apps/worker/package.json`:
```json
{
  "name": "@app/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "bullmq": "^5.0.0", "ioredis": "^5.4.0" },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0" }
}
```
`apps/worker/tsconfig.json`: `{ "extends": "../../packages/config/tsconfig.base.json", "include": ["src","test"] }`
`apps/worker/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", testTimeout: 20000 } });
```

- [ ] **Step 2: Teste do job (falha primeiro)**

`apps/worker/test/health.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { registerHealthWorker } from "../src/health.processor";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

afterAll(async () => { await connection.quit(); });

describe("fila system", () => {
  it("T5: processa health.noop até completar", async () => {
    const worker = registerHealthWorker(connection);
    const queue = new Queue("system", { connection });
    const events = new QueueEvents("system", { connection });
    await events.waitUntilReady();

    const job = await queue.add("health.noop", {});
    const result = await job.waitUntilFinished(events);
    expect(result).toEqual({ ok: true });

    await worker.close(); await queue.close(); await events.close();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd apps/worker && npx vitest run`
Expected: FAIL — `registerHealthWorker` não existe.

- [ ] **Step 4: Implementação**

`apps/worker/src/queue.ts`:
```ts
export const SYSTEM_QUEUE = "system";
export const HEALTH_NOOP = "health.noop";
```

`apps/worker/src/health.processor.ts`:
```ts
import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { SYSTEM_QUEUE, HEALTH_NOOP } from "./queue";

export function registerHealthWorker(connection: Redis) {
  return new Worker(
    SYSTEM_QUEUE,
    async (job) => {
      if (job.name === HEALTH_NOOP) return { ok: true };
      return { ok: false };
    },
    { connection },
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/worker && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(worker): BullMQ system queue with health.noop job"
```

---

## Task 8: Web Vue PWA — auth (Better Auth client), i18n, design tokens

**Files:**
- Create (scaffold) + Modify: `apps/web/*`
- Create: `apps/web/src/lib/auth.ts`, `apps/web/src/stores/auth.ts`, `apps/web/src/views/LoginView.vue`, `apps/web/src/i18n/pt-BR.ts`, `apps/web/src/styles/tokens.css`
- Test: `apps/web/src/stores/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: Better Auth (via fetch para `apps/api`); `GET /workspaces` para confirmar workspace pós-login.
- Produces: PWA instalável com signup/login funcionando.

- [ ] **Step 1: Scaffold Vue + libs**

```bash
cd apps/web
pnpm create vite@latest . -- --template vue-ts
pnpm add vue-router pinia vue-i18n better-auth @app/shared
pnpm add -D vite-plugin-pwa vitest @vue/test-utils jsdom
```
`apps/web/package.json`: `name` = `@app/web`; adicionar `"test": "vitest run"`, `"typecheck": "vue-tsc --noEmit"`.
Em `vite.config.ts`: registrar `VitePWA({ registerType: "autoUpdate" })`.
Criar `apps/web/.env`: `VITE_API_URL=http://127.0.0.1:3000`.

- [ ] **Step 2: Cliente Better Auth no frontend**

`apps/web/src/lib/auth.ts`:
```ts
import { createAuthClient } from "better-auth/vue";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
});
```

- [ ] **Step 3: Teste do store de auth (falha primeiro)**

`apps/web/src/stores/__tests__/auth.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../../lib/auth", () => ({
  authClient: {
    signIn: {
      email: vi.fn(async () => ({
        data: { token: "tok", user: { id: "u1" } },
        error: null,
      })),
    },
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: null })),
  },
}));

import { useAuthStore } from "../auth";

describe("auth store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("login define o token e o usuário", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "x");
    expect(store.accessToken).toBe("tok");
    expect(store.userId).toBe("u1");
    expect(store.isAuthenticated).toBe(true);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd apps/web && npx vitest run -- auth`
Expected: FAIL — store `../auth` inexistente.

- [ ] **Step 5: Store de auth**

`apps/web/src/stores/auth.ts`:
```ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { authClient } from "../lib/auth";

export const useAuthStore = defineStore("auth", () => {
  const accessToken = ref<string | null>(null);
  const userId = ref<string | null>(null);
  const isAuthenticated = computed(() => !!accessToken.value);

  async function signIn(email: string, password: string) {
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message);
    accessToken.value = data.token ?? null;
    userId.value = data.user?.id ?? null;
  }

  async function signUp(email: string, password: string, name: string) {
    const { error } = await authClient.signUp.email({ email, password, name });
    if (error) throw new Error(error.message);
  }

  async function signOut() {
    await authClient.signOut();
    accessToken.value = null;
    userId.value = null;
  }

  async function restoreSession() {
    const { data } = await authClient.getSession();
    if (data?.session) {
      accessToken.value = data.session.token;
      userId.value = data.user?.id ?? null;
    }
  }

  return { accessToken, userId, isAuthenticated, signIn, signUp, signOut, restoreSession };
});
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/web && npx vitest run -- auth`
Expected: PASS.

- [ ] **Step 7: i18n, tokens e LoginView**

`apps/web/src/i18n/pt-BR.ts`:
```ts
export default {
  auth: { login: "Entrar", signup: "Criar conta", email: "E-mail", password: "Senha", name: "Nome" },
  workspace: { personal: "Pessoal" },
};
```

`apps/web/src/styles/tokens.css`:
```css
:root {
  --color-bg: #0b0b0f; --color-surface: #15151c; --color-primary: #4f7cff;
  --color-text: #e8e8ef; --radius: 12px; --space: 8px;
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}
```

`apps/web/src/views/LoginView.vue`:
```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth";
const auth = useAuthStore();
const email = ref(""); const password = ref(""); const erro = ref("");
onMounted(() => auth.restoreSession());
async function entrar() {
  erro.value = "";
  try { await auth.signIn(email.value, password.value); }
  catch (e) { erro.value = (e as Error).message; }
}
</script>
<template>
  <main class="login">
    <input v-model="email" type="email" placeholder="E-mail" />
    <input v-model="password" type="password" placeholder="Senha" />
    <button @click="entrar">Entrar</button>
    <p v-if="erro" role="alert">{{ erro }}</p>
  </main>
</template>
```

Note: `restoreSession()` em `onMounted` garante que a sessão é restaurada após reload da página (Better Auth persiste o token em cookie httpOnly).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): Vue PWA scaffold with Better Auth client, auth store, i18n pt-BR and design tokens"
```

---

## Task 9: CI (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: pipeline com PostgreSQL e Redis efêmeros. Cenário T6.

- [ ] **Step 1: Workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: financas
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Run Prisma migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://app:app@localhost:5432/financas
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
        env:
          DATABASE_URL: postgresql://app:app@localhost:5432/financas
          REDIS_URL: redis://127.0.0.1:6379
```

- [ ] **Step 2: Verificar verde**

Push para um branch e abrir PR. Expected: job `build-test` verde.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: lint+typecheck+test with ephemeral postgres and redis"
```

---

## Self-review

- **Cobertura do spec:** T1 (Task 4) · T2/T4 (Task 5 e2e) · T3 (Task 6) · T5 (Task 7) · T6 (Task 9).
- **Stack:** PostgreSQL 16 + Prisma + Better Auth + BullMQ + Vue 3 PWA.
- **Sem Supabase:** auth gerenciado pelo Better Auth, isolamento multi-tenant na camada NestJS/Prisma.
- **Persistência de sessão:** `restoreSession()` em `onMounted` corrige o bug de logout no reload (Task 8).

---

## Execução

Tasks 1–9 são sequenciais. Recomendado: **subagent-driven-development** com revisão por task.
