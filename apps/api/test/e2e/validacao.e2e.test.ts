import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";

let app: NestFastifyApplication;
let h: Record<string, string>;
let userId: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const u = await auth.api.signUpEmail({ body: { email: `val_${Date.now()}@test.com`, password: "senha123!", name: "Val" } });
  userId = u!.user.id;
  h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

const CASES: Array<{ name: string; method: "POST"; url: string; payload: unknown }> = [
  { name: "chat sem mensagem", method: "POST", url: "/chat", payload: {} },
  { name: "bill com valor decimal", method: "POST", url: "/bills", payload: { name: "Luz", amountCents: 10.5, dueDate: "2026-10-10" } },
  { name: "bill com data inválida", method: "POST", url: "/bills", payload: { name: "Luz", amountCents: 1000, dueDate: "10/10/2026" } },
  { name: "goal com alvo decimal", method: "POST", url: "/goals", payload: { name: "Viagem", targetCents: 99.9 } },
  { name: "split sem lista", method: "POST", url: "/transactions/qualquer/splits", payload: { splits: "x" } },
  { name: "push sem keys", method: "POST", url: "/push/subscribe", payload: { endpoint: "https://a.b/c" } },
  { name: "ingest texto vazio", method: "POST", url: "/ingest/text", payload: { text: "   " } },
  { name: "upload-url com extensão suspeita", method: "POST", url: "/ingest/upload-url", payload: { ext: "../x", contentType: "image/png" } },
  { name: "csv preview sem csv", method: "POST", url: "/import/csv/preview", payload: { accountId: "a", mapping: {} } },
  { name: "mapping com formato inválido", method: "POST", url: "/import/mappings", payload: { name: "x", format: "xml", mapping: {} } },
  { name: "business com cnpj curto", method: "POST", url: "/business-profile", payload: { cnpj: "123" } },
];

describe("Corpos inválidos respondem 400 (nunca 500)", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const res = await app.inject({ method: c.method, url: c.url, headers: h, payload: c.payload as object });
      expect(res.statusCode, res.body).toBe(400);
    });
  }

  it("goal com contribuição negativa responde 400 e positiva 201", async () => {
    const goal = await app.inject({ method: "POST", url: "/goals", headers: h, payload: { name: "Reserva", targetCents: 100000 } });
    expect(goal.statusCode).toBe(201);
    const id = goal.json().id as string;
    const neg = await app.inject({ method: "POST", url: `/goals/${id}/contribute`, headers: h, payload: { amountCents: -5 } });
    expect(neg.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/goals/${id}/contribute`, headers: h, payload: { amountCents: 500, date: "2026-10-01" } });
    expect(ok.statusCode).toBe(201);
  });

  it("split exige que todos os usuários sejam membros do workspace", async () => {
    const acc = await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "cash", name: "Bolso" } });
    const tx = await app.inject({
      method: "POST", url: "/transactions", headers: h,
      payload: { type: "expense", amountCents: 1000, date: "2026-10-01", accountId: acc.json().id },
    });
    const res = await app.inject({
      method: "POST", url: `/transactions/${tx.json().id}/splits`, headers: h,
      payload: { splits: [{ userId, shareCents: 500 }, { userId: "estranho", shareCents: 500 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
