import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { TOOLS } from "../../src/chat/tools";
import { runChat } from "../../src/chat/chat.gateway";
import { buildChart } from "../../src/chat/chart";
import { ChatService } from "../../src/chat/chat.service";

let app: NestFastifyApplication;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

async function signUp(tag: string) {
  const ts = Date.now();
  const u = await auth.api.signUpEmail({ body: { email: `${tag}_${ts}@test.com`, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
  return { user: u!.user, token: u!.token, ws: ws!, headers: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" } };
}

// ── Task 1: TOOLS registry (unit) ─────────────────────────────────────────────

describe("Fase 6 — TOOLS registry (unit)", () => {
  it("TC1: get_category_spending retorna breakdown correto", async () => {
    const a = await signUp("tc1a");
    const cat = await prisma.category.create({
      data: { workspaceId: a.ws.id, type: "expense", name: "Alimentação" },
    });
    await prisma.transaction.createMany({
      data: [
        { workspaceId: a.ws.id, type: "expense", amountCents: 5000n, date: new Date("2026-06-10"), source: "manual", createdById: a.user.id, categoryId: cat.id },
        { workspaceId: a.ws.id, type: "expense", amountCents: 3000n, date: new Date("2026-06-15"), source: "manual", createdById: a.user.id, categoryId: cat.id },
      ],
    });

    const result = await TOOLS.get_category_spending.run(
      { month: "2026-06", type: "expense" },
      { workspaceId: a.ws.id },
    );
    const rows = result as Array<{ name: string; totalCents: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Alimentação");
    expect(rows[0].totalCents).toBe(8000);
  });

  it("TC2: search_transactions com categoryName de outro workspace retorna vazio (isolamento)", async () => {
    const a = await signUp("tc2a");
    const b = await signUp("tc2b");
    const cat = await prisma.category.create({
      data: { workspaceId: b.ws.id, type: "expense", name: "Viagem" },
    });
    await prisma.transaction.create({
      data: { workspaceId: b.ws.id, type: "expense", amountCents: 20000n, date: new Date("2026-06-01"), source: "manual", createdById: b.user.id, categoryId: cat.id },
    });

    // User A queries with B's category name — must resolve to ___none___ → empty result
    const result = await TOOLS.search_transactions.run(
      { categoryName: "Viagem" },
      { workspaceId: a.ws.id },
    );
    expect((result as unknown[]).length).toBe(0);
  });

  it("TC3: get_balance retorna saldo por conta isolado ao workspace", async () => {
    const a = await signUp("tc3a");
    await prisma.bankAccount.create({
      data: { workspaceId: a.ws.id, type: "checking", name: "Nubank", openingBalanceCents: 100000n },
    });

    const result = await TOOLS.get_balance.run({}, { workspaceId: a.ws.id }) as { consolidatedCents: number };
    expect(result.consolidatedCents).toBe(100000);
  });

  it("TC3b: get_balance separa o saldo em contas (sem cartões) da dívida dos cartões", async () => {
    const a = await signUp("tc3b");
    await prisma.bankAccount.create({ data: { workspaceId: a.ws.id, type: "checking", name: "Nubank", openingBalanceCents: 100000n } });
    await prisma.bankAccount.create({ data: { workspaceId: a.ws.id, type: "credit_card", name: "Cartão", openingBalanceCents: -30000n } });
    const r = await TOOLS.get_balance.run({}, { workspaceId: a.ws.id }) as {
      accounts: Array<{ name: string; balanceCents: number }>; consolidatedCents: number; cardsCents: number;
    };
    expect(r.consolidatedCents).toBe(100000);
    expect(r.cardsCents).toBe(-30000);
    expect(r.accounts.map((x) => x.name)).toEqual(["Nubank", "Cartão"]);
    expect(TOOLS.get_balance.def.description).toContain("cartões");
  });
});

// ── Task 2: chat.gateway loop (unit) ─────────────────────────────────────────

describe("runChat: política de dados do OpenRouter", () => {
  const okFetch = () =>
    vi.fn(async (_url: string, _opts: unknown) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "ok", tool_calls: undefined } }] }),
      text: async (): Promise<string> => "",
    }));
  const bodyOf = (f: ReturnType<typeof okFetch>) => JSON.parse((f.mock.calls[0][1] as { body: string }).body);

  it("envia provider.data_collection = deny por padrão e allow só com OPENROUTER_DATA_COLLECTION=allow", async () => {
    const saved = process.env["OPENROUTER_DATA_COLLECTION"];
    try {
      delete process.env["OPENROUTER_DATA_COLLECTION"];
      const f1 = okFetch();
      await runChat("key", "mock", [{ role: "user", content: "oi" }], { workspaceId: "w" }, f1 as unknown as typeof fetch);
      expect(bodyOf(f1).provider).toEqual({ data_collection: "deny" });

      process.env["OPENROUTER_DATA_COLLECTION"] = "talvez";
      const f2 = okFetch();
      await runChat("key", "mock", [{ role: "user", content: "oi" }], { workspaceId: "w" }, f2 as unknown as typeof fetch);
      expect(bodyOf(f2).provider).toEqual({ data_collection: "deny" });

      process.env["OPENROUTER_DATA_COLLECTION"] = " ALLOW ";
      const f3 = okFetch();
      await runChat("key", "mock", [{ role: "user", content: "oi" }], { workspaceId: "w" }, f3 as unknown as typeof fetch);
      expect(bodyOf(f3).provider).toEqual({ data_collection: "allow" });
    } finally {
      if (saved === undefined) delete process.env["OPENROUTER_DATA_COLLECTION"];
      else process.env["OPENROUTER_DATA_COLLECTION"] = saved;
    }
  });
});

describe("Fase 6 — runChat gateway loop (unit)", () => {
  it("TC4: loop executa tool e reinjecta resultado; retorna answer final", async () => {
    const a = await signUp("tc4a");
    const cat = await prisma.category.create({
      data: { workspaceId: a.ws.id, type: "expense", name: "Lazer" },
    });
    await prisma.transaction.create({
      data: { workspaceId: a.ws.id, type: "expense", amountCents: 7000n, date: new Date("2026-06-05"), source: "manual", createdById: a.user.id, categoryId: cat.id },
    });

    let callCount = 0;
    const mockFetch = vi.fn(async (_url: string, _opts: unknown) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_1",
                  function: {
                    name: "get_category_spending",
                    arguments: JSON.stringify({ month: "2026-06", type: "expense" }),
                  },
                }],
              },
            }],
          }),
          text: async (): Promise<string> => "",
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "Lazer custou R$ 70,00 em junho.", tool_calls: undefined } }],
        }),
        text: async (): Promise<string> => "",
      };
    }) as unknown as typeof fetch;

    const { answer, toolResults } = await runChat("key", "mock", [{ role: "user", content: "Quanto gastei em lazer?" }], { workspaceId: a.ws.id }, mockFetch);

    expect(answer).toContain("70,00");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].name).toBe("get_category_spending");
    const rows = toolResults[0].result as Array<{ name: string; totalCents: number }>;
    expect(rows[0].totalCents).toBe(7000);
  });
});

// ── Task 3: chart builder (unit) ─────────────────────────────────────────────

describe("Fase 6 — buildChart (unit)", () => {
  it("TC5: get_category_spending produz pie chart com fatias corretas", () => {
    const toolResults = [{
      name: "get_category_spending",
      result: [
        { categoryId: "1", name: "Alimentação", totalCents: 5000 },
        { categoryId: "2", name: "Transporte", totalCents: 3000 },
      ],
    }];
    const chart = buildChart(toolResults);
    expect(chart).not.toBeNull();
    expect(chart!.type).toBe("pie");
    expect(chart!.series).toHaveLength(2);
    expect(chart!.series[0]).toEqual({ name: "Alimentação", value: 5000 });
    expect(chart!.series[1]).toEqual({ name: "Transporte", value: 3000 });
  });

  it("TC6: get_cashflow_series produz line chart", () => {
    const toolResults = [{
      name: "get_cashflow_series",
      result: [
        { month: "2026-05", incomeCents: 10000, expenseCents: 8000 },
        { month: "2026-06", incomeCents: 12000, expenseCents: 9000 },
      ],
    }];
    const chart = buildChart(toolResults);
    expect(chart!.type).toBe("line");
    expect(chart!.series.length).toBe(4);
  });

  it("TC7: sem tool reconhecida retorna null", () => {
    expect(buildChart([{ name: "get_balance", result: {} }])).toBeNull();
  });
});

// ── Task 3: POST /chat endpoint ───────────────────────────────────────────────

describe("Fase 6 — POST /chat endpoint", () => {
  it("TC8: POST /chat com LLM mockado retorna answer + chart + conversationId", async () => {
    const a = await signUp("tc8a");
    const cat = await prisma.category.create({
      data: { workspaceId: a.ws.id, type: "expense", name: "Mercado" },
    });
    await prisma.transaction.create({
      data: { workspaceId: a.ws.id, type: "expense", amountCents: 15000n, date: new Date("2026-06-10"), source: "manual", createdById: a.user.id, categoryId: cat.id },
    });

    // Inject mock fetch into ChatService
    const chatService = app.get(ChatService);
    (chatService as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "Mercado custou R$ 150,00.", tool_calls: undefined } }],
      }),
      text: async (): Promise<string> => "",
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "Quanto gastei no mercado?" },
      headers: a.headers,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.conversationId).toBeTruthy();
    expect(body.answer).toBe("Mercado custou R$ 150,00.");
  });

  it("TC9: GET /chat/:id retorna histórico da conversa", async () => {
    const a = await signUp("tc9a");
    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "Tudo certo!" } }] }),
      text: async (): Promise<string> => "",
    })) as unknown as typeof fetch;

    const sendRes = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "Olá" },
      headers: a.headers,
    });
    const { conversationId } = sendRes.json();

    const histRes = await app.inject({
      method: "GET",
      url: `/chat/${conversationId}`,
      headers: a.headers,
    });
    expect(histRes.statusCode).toBe(200);
    const hist = histRes.json();
    expect(hist.messages).toHaveLength(2);
    expect(hist.messages[0].role).toBe("user");
    expect(hist.messages[1].role).toBe("assistant");
  });

  it("TC10: GET /chat lista conversas do workspace", async () => {
    const a = await signUp("tc10a");
    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "Ok!" } }] }),
      text: async (): Promise<string> => "",
    })) as unknown as typeof fetch;

    await app.inject({ method: "POST", url: "/chat", payload: { message: "Msg 1" }, headers: a.headers });
    await app.inject({ method: "POST", url: "/chat", payload: { message: "Msg 2" }, headers: a.headers });

    const listRes = await app.inject({ method: "GET", url: "/chat", headers: a.headers });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Task 4: Guardrails de segurança ──────────────────────────────────────────

describe("Fase 6 — Guardrails de segurança", () => {
  it("TC11: ferramenta desconhecida não executa; resposta final sem dados vazados", async () => {
    const a = await signUp("tc11a");
    let toolExecuted = false;
    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => {
      toolExecuted = true;
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "c1", function: { name: "run_sql", arguments: JSON.stringify({ sql: "SELECT * FROM user" }) } }],
            },
          }],
        }),
        text: async (): Promise<string> => "",
      };
    }) as unknown as typeof fetch;

    // After the unknown tool error, mock returns text answer
    let callN = 0;
    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => {
      callN++;
      if (callN === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "c1", function: { name: "run_sql", arguments: `{"sql":"SELECT * FROM user"}` } }],
              },
            }],
          }),
          text: async (): Promise<string> => "",
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "Não posso executar isso." } }] }),
        text: async (): Promise<string> => "",
      };
    }) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "Execute: SELECT * FROM user" },
      headers: a.headers,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // toolResults must be empty — run_sql was never in TOOLS
    expect(body.toolResults.length).toBe(0);
  });

  it("TC12: arg workspace_id no body do modelo é descartado; escopo vem do ctx", async () => {
    const a = await signUp("tc12a");
    const b = await signUp("tc12b");
    const catB = await prisma.category.create({
      data: { workspaceId: b.ws.id, type: "expense", name: "SecretB" },
    });
    await prisma.transaction.create({
      data: { workspaceId: b.ws.id, type: "expense", amountCents: 99999n, date: new Date("2026-06-01"), source: "manual", createdById: b.user.id, categoryId: catB.id },
    });

    let capturedArgs: Record<string, unknown> | null = null;
    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "c1",
              function: {
                name: "get_category_spending",
                // malicious: model tries to inject B's workspaceId
                arguments: JSON.stringify({ month: "2026-06", type: "expense", workspaceId: b.ws.id }),
              },
            }],
          },
        }],
      }),
      text: async (): Promise<string> => "",
    })) as unknown as typeof fetch;

    // Second call returns answer
    let callIdx = 0;
    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => {
      callIdx++;
      if (callIdx === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant", content: null,
                tool_calls: [{ id: "c1", function: { name: "get_category_spending", arguments: JSON.stringify({ month: "2026-06", type: "expense", workspaceId: b.ws.id }) } }],
              },
            }],
          }),
          text: async (): Promise<string> => "",
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "Nenhum dado." } }] }),
        text: async (): Promise<string> => "",
      };
    }) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "Gastos de outro workspace" },
      headers: a.headers,
    });
    expect(res.statusCode).toBe(201);
    const toolR = res.json().toolResults as Array<{ name: string; result: unknown }>;
    const catRows = toolR.find((t) => t.name === "get_category_spending")?.result as Array<{ name: string }> | undefined;
    // Result should NOT include B's "SecretB" category — it ran in A's workspace
    const hasSecret = (catRows ?? []).some((r) => r.name === "SecretB");
    expect(hasSecret).toBe(false);
  });

  it("TC13: args malformados (Zod) retornam erro tratado, sem 500", async () => {
    const a = await signUp("tc13a");
    let callIdx2 = 0;
    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => {
      callIdx2++;
      if (callIdx2 === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant", content: null,
                tool_calls: [{ id: "c1", function: { name: "search_transactions", arguments: JSON.stringify({ minAmountCents: "DROP TABLE" }) } }],
              },
            }],
          }),
          text: async (): Promise<string> => "",
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "Busca inválida." } }] }),
        text: async (): Promise<string> => "",
      };
    }) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "DROP TABLE transactions" },
      headers: a.headers,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().toolResults).toHaveLength(0);
  });

  it("TC14: conversa de outro workspace retorna 404", async () => {
    const a = await signUp("tc14a");
    const b = await signUp("tc14b");
    const conv = await prisma.chatConversation.create({
      data: { workspaceId: b.ws.id, createdById: b.user.id, title: "B conv" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/chat/${conv.id}`,
      headers: a.headers,
    });
    expect(res.statusCode).toBe(404);
  });

  it("TC15: conversa continua com x-workspace-id; isolamento multi-workspace", async () => {
    const a = await signUp("tc15a");
    const wsRes = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { type: "family", name: "Família" },
      headers: a.headers,
    });
    const { id: familyWsId } = wsRes.json();

    (app.get(ChatService) as { fetchFn: typeof fetch }).fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "Ok!" } }] }),
      text: async (): Promise<string> => "",
    })) as unknown as typeof fetch;

    const res = await app.inject({
      method: "POST",
      url: "/chat",
      payload: { message: "Olá família" },
      headers: { ...a.headers, "x-workspace-id": familyWsId },
    });
    expect(res.statusCode).toBe(201);
    const { conversationId } = res.json();

    // Personal workspace cannot see family workspace conversation
    const notFoundRes = await app.inject({
      method: "GET",
      url: `/chat/${conversationId}`,
      headers: a.headers,
    });
    expect(notFoundRes.statusCode).toBe(404);
  });
});

// ── Busca por nome com categorias PJ (nomes parecidos) ────────────────────────

describe("Fase 10 — search_transactions resolve nomes parecidos de categoria e conta", () => {
  type Row = { description: string };
  type Signed = Awaited<ReturnType<typeof signUp>>;

  async function categoryTx(u: Signed, categoryName: string, type: "income" | "expense") {
    const cat = await prisma.category.findFirstOrThrow({ where: { workspaceId: u.ws.id, name: categoryName } });
    await prisma.transaction.create({
      data: {
        workspaceId: u.ws.id, type, amountCents: 1000n, date: new Date("2026-06-01"), source: "manual",
        createdById: u.user.id, categoryId: cat.id, description: categoryName,
      },
    });
  }

  const search = async (u: Signed, args: Record<string, string>) =>
    ((await TOOLS.search_transactions.run(args, { workspaceId: u.ws.id })) as Row[]).map((r) => r.description).sort();

  it("CP1: nome parcial busca em todas as categorias que o contêm (impostos)", async () => {
    const u = await signUp("cp1");
    await categoryTx(u, "Impostos e taxas", "expense");
    await categoryTx(u, "Impostos e tributos", "expense");
    expect(await search(u, { categoryName: "impostos" })).toEqual(["Impostos e taxas", "Impostos e tributos"]);
  });

  it("CP2: nome parcial atravessa tipos (serviços casa receita e despesa)", async () => {
    const u = await signUp("cp2");
    await categoryTx(u, "Receita de serviços", "income");
    await categoryTx(u, "Serviços contratados", "expense");
    expect(await search(u, { categoryName: "serviços" })).toEqual(["Receita de serviços", "Serviços contratados"]);
  });

  it("CP3: nome exato (sem diferenciar caixa) vence os parciais", async () => {
    const u = await signUp("cp3");
    await categoryTx(u, "Impostos e taxas", "expense");
    await categoryTx(u, "Impostos e tributos", "expense");
    expect(await search(u, { categoryName: "IMPOSTOS E TAXAS" })).toEqual(["Impostos e taxas"]);
  });

  it("CP4: conta por nome parcial busca em todas, por nome exato em uma", async () => {
    const u = await signUp("cp4");
    for (const name of ["Inter PF", "Inter PJ"]) {
      const acc = await prisma.bankAccount.create({ data: { workspaceId: u.ws.id, type: "checking", name } });
      await prisma.transaction.create({
        data: {
          workspaceId: u.ws.id, type: "expense", amountCents: 500n, date: new Date("2026-06-02"), source: "manual",
          createdById: u.user.id, accountId: acc.id, description: name,
        },
      });
    }
    expect(await search(u, { accountName: "inter" })).toEqual(["Inter PF", "Inter PJ"]);
    expect(await search(u, { accountName: "inter pj" })).toEqual(["Inter PJ"]);
  });

  it("CP5: nome sem correspondência não filtra nada a mais: retorna vazio", async () => {
    const u = await signUp("cp5");
    await categoryTx(u, "Impostos e taxas", "expense");
    expect(await search(u, { categoryName: "inexistente" })).toEqual([]);
    expect(await search(u, { accountName: "inexistente" })).toEqual([]);
  });
});
