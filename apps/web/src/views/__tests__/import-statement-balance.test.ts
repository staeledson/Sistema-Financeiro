import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const { detectMock, previewMock, listBatchesMock, httpMock } = vi.hoisted(() => ({
  detectMock: vi.fn(),
  previewMock: vi.fn(),
  listBatchesMock: vi.fn(),
  httpMock: vi.fn(),
}));

vi.mock("../../lib/http", async (orig) => ({ ...(await orig<typeof import("../../lib/http")>()), http: httpMock }));
vi.mock("../../lib/import-client", async (orig) => {
  const mod = await orig<typeof import("../../lib/import-client")>();
  return { ...mod, detectFile: detectMock, previewStatement: previewMock, listBatches: listBatchesMock };
});

import ImportView from "../ImportView.vue";

const account = (over: Record<string, unknown>) => ({
  id: "ck1", type: "checking", name: "Conta C6", entity: "pf", institution: "c6", externalId: null,
  closingDay: null, dueDay: null, creditLimitCents: null, openingBalanceCents: 0, archived: false, ...over,
});

let systemBalances: Record<string, number>;

const row = { type: "expense", amountCents: 1000, date: "2026-09-01", postedDate: null, description: "Compra", fingerprint: "fp1", dup: false, categoryId: null, bankCategory: null };
const statement = (over: Record<string, unknown> = {}) => ({
  batchId: "b1", rows: [row], balanceCheck: null, statementBalance: { dateISO: "2026-09-30", balanceCents: 1659, current: true }, ...over,
});
const detect = (over: Record<string, unknown> = {}) => ({
  format: "ofx", institution: "c6", kind: "statement", accountRef: "999", confidence: 1,
  matchedAccountId: "ck1", accountRefs: [], matchedAccounts: {}, text: "OFX", ...over,
});

const plain = (s: string) => s.replace(/ /g, " ");
const btn = (w: VueWrapper, label: string) => w.findAll("button").find((b) => b.text() === label);

async function runImport(preview: unknown, detected = detect()) {
  detectMock.mockResolvedValue(detected);
  previewMock.mockResolvedValue(preview);
  setActivePinia(createPinia());
  const w = mount(ImportView);
  await flushPromises();
  const input = w.find('input[type="file"]');
  Object.defineProperty(input.element, "files", { value: [new File(["x"], "extrato.ofx")], configurable: true });
  await input.trigger("change");
  await flushPromises();
  await btn(w, "Ver preview")!.trigger("click");
  await flushPromises();
  await w.findAll("button").find((b) => b.text().startsWith("Importar"))!.trigger("click");
  await flushPromises();
  return w;
}

beforeEach(() => {
  systemBalances = { ck1: 1301, cc1: -5000 };
  detectMock.mockReset();
  previewMock.mockReset();
  listBatchesMock.mockReset().mockResolvedValue([]);
  httpMock.mockReset().mockImplementation(async (method: string, path: string, body?: unknown) => {
    if (method === "GET" && path === "/accounts") return [account({}), account({ id: "cc1", type: "credit_card", name: "Cartão" })];
    if (method === "GET" && path === "/categories") return [];
    if (method === "GET" && path === "/balances") {
      const accounts = Object.entries(systemBalances).map(([accountId, balanceCents]) => ({ accountId, name: accountId, type: "checking", balanceCents }));
      return { accounts, consolidatedCents: 0 };
    }
    if (method === "POST" && path === "/import/b1/commit") return { inserted: 1, skipped: 0 };
    const m = /^\/accounts\/([^/]+)\/reconcile$/.exec(path);
    if (method === "POST" && m) {
      const target = (body as { balanceCents: number }).balanceCents;
      const previous = systemBalances[m[1]];
      systemBalances[m[1]] = target;
      return { accountId: m[1], previousBalanceCents: previous, newBalanceCents: target, adjustmentCents: target - previous, openingBalanceCents: 0 };
    }
    throw new Error(`rota inesperada ${method} ${path}`);
  });
});

describe("ImportView: saldo do extrato x saldo do sistema", () => {
  it("mostra os dois saldos depois do commit e o botão de ajuste quando divergem; ajustar chama reconcile", async () => {
    const w = await runImport(statement());
    expect(w.text()).toContain("Concluído");
    expect(plain(w.find("[data-test=statement-balance-line]").text())).toBe("Saldo do extrato: R$ 16,59; saldo no sistema: R$ 13,01");

    const adjust = btn(w, "Ajustar saldo inicial da conta");
    expect(adjust).toBeDefined();
    httpMock.mockClear();
    await adjust!.trigger("click");
    await flushPromises();

    expect(httpMock.mock.calls.find((c) => c[0] === "POST")).toEqual(["POST", "/accounts/ck1/reconcile", { balanceCents: 1659 }]);
    expect(plain(w.text())).toContain("Saldo conciliado: R$ 16,59");
    expect(plain(w.find("[data-test=statement-balance-line]").text())).toBe("Saldo do extrato: R$ 16,59; saldo no sistema: R$ 16,59");
    expect(btn(w, "Ajustar saldo inicial da conta")).toBeUndefined();
  });

  it("saldos iguais: mostra a linha e nenhum botão", async () => {
    systemBalances.ck1 = 1659;
    const w = await runImport(statement());
    expect(plain(w.find("[data-test=statement-balance-line]").text())).toBe("Saldo do extrato: R$ 16,59; saldo no sistema: R$ 16,59");
    expect(btn(w, "Ajustar saldo inicial da conta")).toBeUndefined();
  });

  it("sem saldo corrente no extrato (null ou current=false): nada é mostrado", async () => {
    for (const statementBalance of [null, { dateISO: "2026-09-30", balanceCents: 1659, current: false }]) {
      const w = await runImport(statement({ statementBalance }));
      expect(w.text()).toContain("Concluído");
      expect(w.find("[data-test=statement-balance-line]").exists()).toBe(false);
      expect(btn(w, "Ajustar saldo inicial da conta")).toBeUndefined();
    }
  });

  it("fatura de cartão não mostra a comparação", async () => {
    const w = await runImport(statement(), detect({ kind: "card_invoice", matchedAccountId: "cc1" }));
    expect(w.text()).toContain("Concluído");
    expect(w.find("[data-test=statement-balance-line]").exists()).toBe(false);
  });

  it("falha ao buscar os saldos não atrapalha a conclusão da importação", async () => {
    const original = httpMock.getMockImplementation()!;
    httpMock.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path === "/balances") throw new Error("fora do ar");
      return original(method, path, body);
    });
    const w = await runImport(statement());
    expect(w.text()).toContain("Concluído");
    expect(w.text()).toContain("1 transações importadas");
    expect(w.find("[data-test=statement-balance-line]").exists()).toBe(false);
  });
});
