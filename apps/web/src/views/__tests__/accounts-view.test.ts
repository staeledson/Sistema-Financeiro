import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));
vi.mock("../../lib/http", async (orig) => ({ ...(await orig<typeof import("../../lib/http")>()), http: httpMock }));

import AccountsView from "../AccountsView.vue";
import { useFinanceStore } from "../../stores/finance";
import { localTodayISO } from "../../lib/date";

const account = (over: Record<string, unknown>) => ({
  id: "a1", type: "checking", name: "Conta C6", entity: "pf", institution: "c6", externalId: null,
  closingDay: null, dueDay: null, creditLimitCents: null, openingBalanceCents: 0, archived: false, ...over,
});

let state: { accounts: ReturnType<typeof account>[]; balances: Record<string, number> };

function route(method: string, path: string, body?: unknown) {
  if (method === "GET" && path.startsWith("/accounts")) return state.accounts;
  if (method === "GET" && path === "/balances") {
    const accounts = state.accounts
      .filter((a) => state.balances[a.id] !== undefined)
      .map((a) => ({ accountId: a.id, name: a.name, type: a.type, balanceCents: state.balances[a.id] }));
    const sum = (list: typeof accounts) => list.reduce((s, b) => s + b.balanceCents, 0);
    return {
      accounts,
      consolidatedCents: sum(accounts.filter((b) => b.type !== "credit_card")),
      cardsCents: sum(accounts.filter((b) => b.type === "credit_card")),
    };
  }
  const m = /^\/accounts\/([^/]+)\/reconcile$/.exec(path);
  if (method === "POST" && m) {
    const target = (body as { balanceCents: number }).balanceCents;
    const previous = state.balances[m[1]];
    state.balances[m[1]] = target;
    return { accountId: m[1], previousBalanceCents: previous, newBalanceCents: target, adjustmentCents: target - previous, openingBalanceCents: target - previous };
  }
  throw new Error(`rota inesperada ${method} ${path}`);
}

async function mountView(preload?: (store: ReturnType<typeof useFinanceStore>) => void) {
  setActivePinia(createPinia());
  if (preload) preload(useFinanceStore());
  const w = mount(AccountsView);
  await flushPromises();
  return w;
}

const plain = (s: string) => s.replace(/ /g, " ");
const buttonByText = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").filter((b) => b.text() === text);

beforeEach(() => {
  state = {
    accounts: [account({}), account({ id: "c1", type: "credit_card", name: "Cartão final 1111" })],
    balances: { a1: 8000, c1: -25000 },
  };
  httpMock.mockReset().mockImplementation(async (method: string, path: string, body?: unknown) => route(method, path, body));
});

describe("AccountsView: saldos", () => {
  it("mostra 'Saldo em contas' (sem cartões) e 'Cartões a pagar' à parte", async () => {
    const w = await mountView();
    const text = plain(w.find(".consolidated").text());
    expect(text).toContain("Saldo em contas: R$ 80,00");
    expect(text).toContain("Cartões a pagar: -R$ 250,00");
    expect(text).not.toContain("consolidado");
  });

  it("o filtro PF/PJ recalcula as duas linhas; sem cartão a segunda linha some", async () => {
    state.accounts.push(account({ id: "p1", name: "Conta PJ", entity: "pj" }));
    state.balances.p1 = 5000;
    const w = await mountView();
    await w.findAll("button").filter((b) => b.text() === "PJ")[0].trigger("click");
    const text = plain(w.find(".consolidated").text());
    expect(text).toContain("PJ: R$ 50,00");
    expect(text).not.toContain("Cartões a pagar");
  });
});

describe("AccountsView: Conciliar saldo", () => {
  it("oferece a ação em cada conta e abre o formulário com o saldo atual do sistema", async () => {
    const w = await mountView();
    const buttons = buttonByText(w, "Conciliar saldo");
    expect(buttons).toHaveLength(2);
    await buttons[0].trigger("click");
    expect(plain(w.text())).toContain("Saldo no sistema: R$ 80,00");
    expect(w.find("label").text()).toBe("Saldo real hoje (R$)");
    expect(w.text()).not.toContain("valor devido como negativo");
  });

  it("mostra a prévia do ajuste enquanto digita e envia centavos ao confirmar", async () => {
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    const input = w.find("#reconcile-a1");

    await input.setValue("16,59");
    expect(plain(w.find("[data-test=reconcile-preview]").text())).toBe("Ajuste de saldo inicial: −R$ 63,41");
    await input.setValue("1.000,00");
    expect(plain(w.find("[data-test=reconcile-preview]").text())).toBe("Ajuste de saldo inicial: +R$ 920,00");
    await input.setValue("16,59");

    httpMock.mockClear();
    await w.find("form.reconcile-form").trigger("submit");
    await flushPromises();

    const post = httpMock.mock.calls.find((c) => c[0] === "POST");
    expect(post).toEqual(["POST", "/accounts/a1/reconcile", { balanceCents: 1659 }]);
    // recarrega contas e saldos
    expect(httpMock.mock.calls.some((c) => c[0] === "GET" && String(c[1]).startsWith("/accounts"))).toBe(true);
    expect(httpMock.mock.calls.some((c) => c[0] === "GET" && c[1] === "/balances")).toBe(true);
    expect(plain(w.text())).toContain("Saldo conciliado: R$ 16,59");
    expect(w.find("form.reconcile-form").exists()).toBe(false);
    expect(plain(w.find(".account-item").text())).toContain("R$ 16,59");
  });

  it("aceita valor negativo e ponto decimal", async () => {
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    await w.find("#reconcile-a1").setValue("-120.5");
    await w.find("form.reconcile-form").trigger("submit");
    await flushPromises();
    expect(httpMock.mock.calls.find((c) => c[0] === "POST")?.[2]).toEqual({ balanceCents: -12050 });
  });

  it("texto inválido: sem prévia, aviso de valor inválido e confirmar desabilitado; nada é enviado", async () => {
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    await w.find("#reconcile-a1").setValue("16,599");
    expect(w.find("[data-test=reconcile-preview]").exists()).toBe(false);
    expect(w.text()).toContain("Valor inválido");
    const confirm = buttonByText(w, "Confirmar conciliação")[0];
    expect(confirm.attributes("disabled")).toBeDefined();
    await w.find("form.reconcile-form").trigger("submit");
    await flushPromises();
    expect(httpMock.mock.calls.some((c) => c[0] === "POST")).toBe(false);
  });

  it("cartão: o texto de ajuda pede o valor devido como negativo", async () => {
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[1].trigger("click");
    expect(plain(w.text())).toContain("Saldo no sistema: -R$ 250,00");
    expect(w.text()).toContain("Informe o total devido hoje (fatura aberta + parcelas), como valor negativo");
  });

  it("cartão: valor positivo mostra aviso (sem bloquear); negativo não mostra", async () => {
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[1].trigger("click");
    await w.find("#reconcile-c1").setValue("500,00");
    expect(w.find("[data-test=reconcile-card-warning]").text()).toContain("em cartão, o valor devido é negativo");
    expect(buttonByText(w, "Confirmar conciliação")[0].attributes("disabled")).toBeUndefined();
    await w.find("#reconcile-c1").setValue("-500,00");
    expect(w.find("[data-test=reconcile-card-warning]").exists()).toBe(false);
    // conta corrente nunca mostra o aviso
    await buttonByText(w, "Cancelar")[0].trigger("click");
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    await w.find("#reconcile-a1").setValue("500,00");
    expect(w.find("[data-test=reconcile-card-warning]").exists()).toBe(false);
  });

  it("mostra o saldo informado ao lado do ajuste, em região aria-live educada", async () => {
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    await w.find("#reconcile-a1").setValue("6.508,80");
    expect(plain(w.find("[data-test=reconcile-informed]").text())).toBe("Saldo informado: R$ 6.508,80");
    expect(w.find("[data-test=reconcile-preview]").element.closest("[aria-live=polite]")).not.toBeNull();
  });

  it("sem o saldo da conta carregado: formulário desabilitado e nada é enviado (não usa o saldo inicial)", async () => {
    delete state.balances.a1;
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    expect(w.text()).toContain("Os saldos ainda não foram carregados");
    expect(w.text()).not.toContain("Saldo no sistema");
    const input = w.find("#reconcile-a1");
    expect(input.attributes("disabled")).toBeDefined();
    expect(buttonByText(w, "Confirmar conciliação")[0].attributes("disabled")).toBeDefined();
    await w.find("form.reconcile-form").trigger("submit");
    await flushPromises();
    expect(httpMock.mock.calls.some((c) => c[0] === "POST")).toBe(false);
  });

  it("lançamentos futuros já carregados no store viram uma nota; sem transações carregadas não há nota", async () => {
    const future = "2999-01-01";
    const tx = (over: Record<string, unknown>) => ({ type: "expense", amountCents: 1000, date: future, accountId: "a1", sourceAccountId: null, destAccountId: null, ...over });
    const w = await mountView((store) => {
      store.transactions = [tx({}), tx({ type: "income", amountCents: 300 }), tx({ date: localTodayISO() }), tx({ accountId: "c1" })] as never;
    });
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    expect(plain(w.find("[data-test=reconcile-future]").text())).toBe("Há 2 lançamentos com data futura (total -R$ 7,00); eles entram no saldo de hoje.");

    const w2 = await mountView();
    await buttonByText(w2, "Conciliar saldo")[0].trigger("click");
    expect(w2.find("[data-test=reconcile-future]").exists()).toBe(false);
  });

  it("erro da API aparece como alerta e o formulário continua aberto", async () => {
    httpMock.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (method === "POST") throw new Error("conta não encontrada");
      return route(method, path, body);
    });
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    await w.find("#reconcile-a1").setValue("10");
    await w.find("form.reconcile-form").trigger("submit");
    await flushPromises();
    expect(w.find("[role=alert]").text()).toBe("conta não encontrada");
    expect(w.find("form.reconcile-form").exists()).toBe(true);
  });

  it("Cancelar fecha o formulário sem chamar a API", async () => {
    const w = await mountView();
    await buttonByText(w, "Conciliar saldo")[0].trigger("click");
    await buttonByText(w, "Cancelar")[0].trigger("click");
    expect(w.find("form.reconcile-form").exists()).toBe(false);
    expect(httpMock.mock.calls.some((c) => c[0] === "POST")).toBe(false);
  });

  it("conta arquivada não oferece a ação", async () => {
    state.accounts = [account({ archived: true })];
    const w = await mountView();
    expect(buttonByText(w, "Conciliar saldo")).toHaveLength(0);
  });
});
