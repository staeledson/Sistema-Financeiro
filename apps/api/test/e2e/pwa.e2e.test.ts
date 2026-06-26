import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";

let app: NestFastifyApplication;
let token: string;
let headers: Record<string, string>;  // for requests WITH a JSON body
let authHeaders: Record<string, string>;  // for GET/DELETE (no body)

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const ts = Date.now();
  const u = await auth.api.signUpEmail({ body: { email: `pwa_${ts}@test.com`, password: "senha123!", name: "PWA" } });
  token = u!.token!;
  authHeaders = { authorization: `Bearer ${token}` };
  headers = { ...authHeaders, "content-type": "application/json" };
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Push subscriptions
// ─────────────────────────────────────────────────────────────────────────────

describe("Push subscriptions", () => {
  it("GET /push/vapid-public-key returns a key field", async () => {
    const res = await app.inject({ method: "GET", url: "/push/vapid-public-key", headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("key");
  });

  it("POST /push/subscribe stores a subscription and returns { ok: true }", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/push/subscribe",
      headers,
      payload: {
        endpoint: "https://fcm.example.com/sub/abc123",
        keys: { p256dh: "pk_abc", auth: "auth_abc" },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);

    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: "https://fcm.example.com/sub/abc123" } });
    expect(sub).not.toBeNull();
    expect(sub!.p256dh).toBe("pk_abc");
  });

  it("POST /push/subscribe upserts (updates keys on re-subscribe)", async () => {
    await app.inject({
      method: "POST",
      url: "/push/subscribe",
      headers,
      payload: {
        endpoint: "https://fcm.example.com/sub/abc123",
        keys: { p256dh: "pk_updated", auth: "auth_updated" },
      },
    });
    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: "https://fcm.example.com/sub/abc123" } });
    expect(sub!.p256dh).toBe("pk_updated");

    const count = await prisma.pushSubscription.count({ where: { endpoint: "https://fcm.example.com/sub/abc123" } });
    expect(count).toBe(1);
  });

  it("POST /push/subscribe requires auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/push/subscribe",
      payload: { endpoint: "x", keys: { p256dh: "y", auth: "z" } },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled bills
// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduled bills", () => {
  let billId: string;

  it("POST /bills creates a bill", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/bills",
      headers,
      payload: { name: "Aluguel", amountCents: 150000, dueDate: "2026-07-05", recurrence: "monthly" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    billId = body.id; // capture before any assertions so sibling tests don't cascade-fail
    expect(body.name).toBe("Aluguel");
    expect(body.active).toBe(true);
  });

  it("GET /bills lists active bills", async () => {
    const res = await app.inject({ method: "GET", url: "/bills", headers: authHeaders });
    expect(res.statusCode).toBe(200);
    const list = res.json() as any[];
    expect(list.some((b: any) => b.id === billId)).toBe(true);
  });

  it("DELETE /bills/:id soft-deletes the bill", async () => {
    const res = await app.inject({ method: "DELETE", url: `/bills/${billId}`, headers: authHeaders });
    expect(res.statusCode).toBe(200);

    const listRes = await app.inject({ method: "GET", url: "/bills", headers: authHeaders });
    expect((listRes.json() as any[]).some((b: any) => b.id === billId)).toBe(false);
  });

  it("POST /bills requires auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/bills",
      payload: { name: "X", amountCents: 100, dueDate: "2026-07-01", recurrence: "once" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

describe("Export", () => {
  it("GET /export/transactions.csv returns CSV with header row", async () => {
    const res = await app.inject({ method: "GET", url: "/export/transactions.csv", headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.payload).toContain("id,type,amountCents");
  });

  it("GET /export/transactions.xlsx returns binary XLSX", async () => {
    const res = await app.inject({ method: "GET", url: "/export/transactions.xlsx", headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    // XLSX magic bytes: PK (zip)
    expect(res.rawPayload[0]).toBe(0x50);
    expect(res.rawPayload[1]).toBe(0x4b);
  });

  it("GET /export/backup.json returns a JSON object with workspace key", async () => {
    const res = await app.inject({ method: "GET", url: "/export/backup.json", headers: authHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("workspace");
    expect(body).toHaveProperty("exportedAt");
    expect(body).toHaveProperty("transactions");
    expect(body).toHaveProperty("accounts");
  });

  it("export endpoints require auth", async () => {
    for (const url of ["/export/transactions.csv", "/export/transactions.xlsx", "/export/backup.json"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });
});
