import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

const { detectMock, previewMock, commitMock, listBatchesMock, updateMock } = vi.hoisted(() => ({
  detectMock: vi.fn(),
  previewMock: vi.fn(),
  commitMock: vi.fn(),
  listBatchesMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("../../lib/import-client", async (orig) => {
  const mod = await orig<typeof import("../../lib/import-client")>();
  return { ...mod, detectFile: detectMock, previewStatement: previewMock, commitImport: commitMock, listBatches: listBatchesMock };
});
vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  const acc = (over: Record<string, unknown>) => ({ entity: "pf", institution: "mercado_pago", closingDay: null, dueDay: null, creditLimitCents: null, openingBalanceCents: 0, archived: false, ...over });
  return {
    ...mod,
    api: {
      ...mod.api,
      accounts: {
        ...mod.api.accounts,
        list: vi.fn(async () => [
          acc({ id: "mp", type: "checking", name: "Mercado Pago PF", externalId: "12345" }),
          acc({ id: "ck2", type: "checking", name: "Conta nova", externalId: null }),
          acc({ id: "cc1", type: "credit_card", name: "Cartão A", externalId: "1111" }),
        ]),
        update: updateMock,
      },
      categories: { list: vi.fn(async () => []) },
    },
  };
});

import ImportView from "../ImportView.vue";

const row = (n: number, over: Record<string, unknown> = {}) => ({
  type: "expense", amountCents: 1000 * n, date: "2026-01-0" + n, postedDate: null, description: `Compra ${n}`,
  fingerprint: `fp${n}`, dup: false, categoryId: null, ...over,
});

const detectOf = (over: Record<string, unknown> = {}) => ({
  format: "pdf_statement", institution: "mercado_pago", kind: "statement", accountRef: "12345", confidence: 1,
  matchedAccountId: "mp", accountRefs: [], matchedAccounts: {}, text: "TEXTO", ...over,
});

const okBalance = { ok: true, checkedAt: "2026-01-31", checkpoints: 2, mismatches: [] };
const badBalance = { ok: false, checkedAt: "2026-02-28", checkpoints: 2, mismatches: [{ dateISO: "2026-02-10", expectedCents: 1, computedCents: 2, diffCents: 1 }] };

function previewOf(batchId: string, from: string, to: string, over: Record<string, unknown> = {}) {
  const rows = (over.rows as ReturnType<typeof row>[] | undefined) ?? [row(1), row(2)];
  return {
    batchId, institution: "mercado_pago", accountRef: "12345", period: { from, to }, rows, rowCount: rows.length,
    dupCount: rows.filter((r) => r.dup).length, balanceCheck: null, ...over,
  };
}

// arquivo -> (detect, preview) por nome, para as respostas não dependerem da ordem das chamadas
let detectByName: Record<string, unknown>;
let previewByText: Record<string, unknown>;

async function mountView() {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }, { path: "/categorizar", component: { template: "<div />" } }],
  });
  await router.push("/");
  await router.isReady();
  const w = mount(ImportView, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

async function pick(w: VueWrapper, names: string[]) {
  const input = w.find('input[type="file"]');
  Object.defineProperty(input.element, "files", { value: names.map((n) => new File(["x"], n)), configurable: true });
  await input.trigger("change");
  await flushPromises();
}

const tableRows = (w: VueWrapper) => w.findAll("tbody tr");
const button = (w: VueWrapper, label: string | RegExp) =>
  w.findAll("button").find((b) => (typeof label === "string" ? b.text() === label : label.test(b.text())));

beforeEach(() => {
  detectByName = {};
  previewByText = {};
  detectMock.mockReset().mockImplementation(async (f: File) => detectByName[f.name] ?? detectOf());
  previewMock.mockReset().mockImplementation(async (body: { text: string }) => previewByText[body.text]);
  commitMock.mockReset().mockResolvedValue({ inserted: 2, skipped: 0 });
  listBatchesMock.mockReset().mockResolvedValue([]);
  updateMock.mockReset().mockImplementation(async (id: string, body: Record<string, unknown>) => ({
    id, type: "checking", name: "Conta nova", entity: "pf", institution: "mercado_pago", closingDay: null, dueDay: null,
    creditLimitCents: null, openingBalanceCents: 0, archived: false, externalId: null, ...body,
  }));
});

function threeStatements() {
  detectByName = {
    "mar.pdf": detectOf({ text: "T-MAR" }),
    "jan.pdf": detectOf({ text: "T-JAN" }),
    "fev.pdf": detectOf({ text: "T-FEV" }),
  };
  previewByText = {
    "T-MAR": previewOf("b-mar", "2026-03-01", "2026-03-31", { balanceCheck: okBalance }),
    "T-JAN": previewOf("b-jan", "2026-01-01", "2026-01-31", { balanceCheck: okBalance }),
    "T-FEV": previewOf("b-fev", "2026-02-01", "2026-02-28", { balanceCheck: badBalance }),
  };
}

describe("ImportView: importação em lote", () => {
  it("vários arquivos abrem o passo de lote e listam as entradas em ordem cronológica", async () => {
    threeStatements();
    const w = await mountView();
    await pick(w, ["mar.pdf", "jan.pdf", "fev.pdf"]);
    expect(w.text()).toContain("Importação em lote");
    expect(detectMock).toHaveBeenCalledTimes(3);
    const rows = tableRows(w);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.text()).map((t) => /(jan|fev|mar)\.pdf/.exec(t)![1])).toEqual(["jan", "fev", "mar"]);
    const jan = rows[0].text();
    expect(jan).toContain("Mercado Pago");
    expect(jan).toContain("Mercado Pago PF");
    expect(jan).toContain("01/01/2026");
    expect(jan).toContain("31/01/2026");
    expect(jan).toContain("confere");
    expect(w.find("input[aria-label='Importar jan.pdf']").exists()).toBe(true);
  });

  it("marca por padrão quando o saldo confere e desmarca com divergência, avisando", async () => {
    threeStatements();
    const w = await mountView();
    await pick(w, ["mar.pdf", "jan.pdf", "fev.pdf"]);
    const checked = (name: string) => (w.find(`input[aria-label='Importar ${name}']`).element as HTMLInputElement).checked;
    expect(checked("jan.pdf")).toBe(true);
    expect(checked("fev.pdf")).toBe(false);
    expect(checked("mar.pdf")).toBe(true);
    expect(tableRows(w)[1].text()).toContain("divergência");
    expect(w.text()).toMatch(/divergência de saldo/i);
    expect(button(w, "Importar 2 arquivos")).toBeTruthy();
  });

  it("desmarcar um arquivo tira ele da importação e do contador do botão", async () => {
    threeStatements();
    const w = await mountView();
    await pick(w, ["mar.pdf", "jan.pdf", "fev.pdf"]);
    await w.find("input[aria-label='Importar jan.pdf']").setValue(false);
    expect(button(w, "Importar 1 arquivo")).toBeTruthy();
    await button(w, "Importar 1 arquivo")!.trigger("click");
    await flushPromises();
    expect(commitMock.mock.calls.map((c) => c[0])).toEqual(["b-mar"]);
  });

  it("arquivo sem linhas novas mostra 'nada novo' e fica desmarcado e desabilitado", async () => {
    detectByName = { "a.pdf": detectOf({ text: "T-A" }), "b.pdf": detectOf({ text: "T-B" }) };
    previewByText = {
      "T-A": previewOf("b-a", "2026-01-01", "2026-01-31", { rows: [row(1, { dup: true }), row(2, { dup: true })] }),
      "T-B": previewOf("b-b", "2026-02-01", "2026-02-28"),
    };
    const w = await mountView();
    await pick(w, ["a.pdf", "b.pdf"]);
    expect(tableRows(w)[0].text()).toContain("nada novo");
    const box = w.find("input[aria-label='Importar a.pdf']").element as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(button(w, "Importar 1 arquivo")).toBeTruthy();
  });

  it("lista os arquivos que precisam ser importados individualmente, com o motivo, sem derrubar o lote", async () => {
    detectByName = {
      "ok.pdf": detectOf({ text: "T-OK" }),
      "gen.csv": detectOf({ format: "csv", kind: null, matchedAccountId: null }),
      "outro.pdf": detectOf({ format: "pdf", kind: null, matchedAccountId: null }),
    };
    previewByText = { "T-OK": previewOf("b-ok", "2026-01-01", "2026-01-31") };
    const w = await mountView();
    await pick(w, ["ok.pdf", "gen.csv", "outro.pdf"]);
    expect(tableRows(w)).toHaveLength(1);
    const text = w.text();
    expect(text).toContain("precisa ser importado individualmente");
    expect(text).toContain("gen.csv");
    expect(text).toContain("mapeamento");
    expect(text).toContain("outro.pdf");
    expect(text).toContain("IA");
  });

  it("arquivos sem conta casada formam um grupo por ref com um seletor só, que resolve todos de uma vez", async () => {
    detectByName = {
      "jan.pdf": detectOf({ text: "T-JAN", accountRef: "999", matchedAccountId: null }),
      "fev.pdf": detectOf({ text: "T-FEV", accountRef: "999", matchedAccountId: null }),
    };
    previewByText = {
      "T-JAN": previewOf("b-jan", "2026-01-01", "2026-01-31"),
      "T-FEV": previewOf("b-fev", "2026-02-01", "2026-02-28"),
    };
    const w = await mountView();
    await pick(w, ["jan.pdf", "fev.pdf"]);
    expect(previewMock).not.toHaveBeenCalled();
    expect(tableRows(w)).toHaveLength(0);
    expect(w.text()).toContain("aguardando conta");
    const selects = w.findAll("select");
    expect(selects).toHaveLength(1);
    // só contas que não são cartão
    expect(selects[0].findAll("option").map((o) => o.text())).toEqual(["— Selecione uma conta —", "Mercado Pago PF", "Conta nova"]);
    expect(button(w, /^Importar/)?.attributes("disabled")).toBeDefined();

    await selects[0].setValue("ck2");
    await flushPromises();
    expect(previewMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith("ck2", { externalId: "999" });
    expect(w.findAll("select")).toHaveLength(0);
    expect(tableRows(w)).toHaveLength(2);
    expect(tableRows(w)[0].text()).toContain("Conta nova");
  });

  it("'Lembrar esta conta' desmarcado não grava o número na conta", async () => {
    detectByName = { "jan.pdf": detectOf({ text: "T-JAN", accountRef: "999", matchedAccountId: null }), "fev.pdf": detectOf({ text: "T-FEV", accountRef: "999", matchedAccountId: null }) };
    previewByText = { "T-JAN": previewOf("b-jan", "2026-01-01", "2026-01-31"), "T-FEV": previewOf("b-fev", "2026-02-01", "2026-02-28") };
    const w = await mountView();
    await pick(w, ["jan.pdf", "fev.pdf"]);
    const remember = w.find("input[type='checkbox'][aria-label='Lembrar esta conta para os próximos arquivos']");
    expect((remember.element as HTMLInputElement).checked).toBe(true);
    await remember.setValue(false);
    await w.find("select").setValue("ck2");
    await flushPromises();
    expect(updateMock).not.toHaveBeenCalled();
    expect(previewMock).toHaveBeenCalledTimes(2);
  });

  it("fatura CSV: um grupo por cartão sem conta, só com contas de cartão", async () => {
    detectByName = {
      "fatura.csv": detectOf({
        format: "csv_invoice", institution: "c6", kind: "card_invoice", accountRef: null, matchedAccountId: null,
        accountRefs: ["1111", "2222"], matchedAccounts: { "1111": "cc1", "2222": null }, text: "T-FAT",
      }),
      "mar.pdf": detectOf({ text: "T-MAR" }),
    };
    previewByText = {
      "T-FAT": previewOf("b-fat", "2026-02-01", "2026-02-28", { institution: "c6" }),
      "T-MAR": previewOf("b-mar", "2026-03-01", "2026-03-31"),
    };
    const w = await mountView();
    await pick(w, ["fatura.csv", "mar.pdf"]);
    expect(previewMock).toHaveBeenCalledWith({ accountId: "cc1", text: "T-FAT", format: "csv_invoice", cardRef: "1111" });
    expect(tableRows(w)).toHaveLength(2);
    const selects = w.findAll("select");
    expect(selects).toHaveLength(1);
    expect(selects[0].findAll("option").map((o) => o.text())).toEqual(["— Selecione um cartão —", "Cartão A"]);
    expect(w.text()).toContain("final 2222");
  });

  it("importar grava os arquivos marcados em ordem cronológica e mostra o resultado e os próximos passos", async () => {
    threeStatements();
    commitMock
      .mockResolvedValueOnce({ inserted: 2, skipped: 0 })
      .mockResolvedValueOnce({ inserted: 1, skipped: 1 });
    const w = await mountView();
    await pick(w, ["mar.pdf", "jan.pdf", "fev.pdf"]);
    await button(w, "Importar 2 arquivos")!.trigger("click");
    await flushPromises();

    expect(commitMock.mock.calls.map((c) => c[0])).toEqual(["b-jan", "b-mar"]);
    const body = commitMock.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ accountId: "mp", fingerprint: "fp1", postedDate: null, categoryId: null });
    expect(listBatchesMock.mock.calls.length).toBeGreaterThan(1);

    const text = w.text();
    expect(text).toContain("2 importados");
    expect(text).toContain("1 importado (1 já existia)");
    expect(text).toMatch(/Total: 3 importados \(1 já existia\)/);
    const link = w.find("a[href='/categorizar']");
    expect(link.exists()).toBe(true);
    expect(text).toContain("Recategorizar pendentes");
    expect(text).toContain("Conciliar saldo");
    expect(w.text()).not.toContain("Ajustar saldo inicial");
  });

  it("a primeira falha interrompe, aponta o arquivo e a mensagem da API, e 'Tentar de novo' retoma dali", async () => {
    threeStatements();
    previewByText["T-FEV"] = previewOf("b-fev", "2026-02-01", "2026-02-28", { balanceCheck: okBalance });
    commitMock
      .mockResolvedValueOnce({ inserted: 2, skipped: 0 })
      .mockRejectedValueOnce(new Error("Lote não encontrado"))
      .mockResolvedValueOnce({ inserted: 2, skipped: 0 })
      .mockResolvedValueOnce({ inserted: 2, skipped: 0 });
    const w = await mountView();
    await pick(w, ["mar.pdf", "jan.pdf", "fev.pdf"]);
    await button(w, "Importar 3 arquivos")!.trigger("click");
    await flushPromises();

    expect(commitMock.mock.calls.map((c) => c[0])).toEqual(["b-jan", "b-fev"]);
    const alert = w.find("[role='alert']").text();
    expect(alert).toContain("fev.pdf");
    expect(alert).toContain("Lote não encontrado");
    // o que já foi importado continua listado; o restante fica sem processar
    expect(w.text()).toContain("2 importados");
    expect(tableRows(w)[2].text()).toContain("não processado");
    expect(w.find("a[href='/categorizar']").exists()).toBe(true);

    await button(w, "Tentar de novo os restantes")!.trigger("click");
    await flushPromises();
    expect(commitMock.mock.calls.map((c) => c[0])).toEqual(["b-jan", "b-fev", "b-fev", "b-mar"]);
    expect(w.find("[role='alert']").exists()).toBe(false);
    expect(w.text()).toMatch(/Total: 6 importados/);
    expect(button(w, "Tentar de novo os restantes")).toBeUndefined();
  });

  it("clique duplo em Importar não grava duas vezes", async () => {
    threeStatements();
    let release!: () => void;
    commitMock.mockImplementation(() => new Promise((res) => { release = () => res({ inserted: 1, skipped: 0 }); }));
    const w = await mountView();
    await pick(w, ["mar.pdf", "jan.pdf"]);
    const b = button(w, /^Importar 2/)!;
    await b.trigger("click");
    await b.trigger("click");
    await flushPromises();
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(button(w, /^Importar/)?.attributes("disabled")).toBeDefined();
    release();
    await flushPromises();
  });

  it("soltar vários arquivos também abre o lote", async () => {
    threeStatements();
    const w = await mountView();
    await w.find("label.dropzone").trigger("drop", { dataTransfer: { files: [new File(["x"], "mar.pdf"), new File(["x"], "jan.pdf")] } });
    await flushPromises();
    expect(w.text()).toContain("Importação em lote");
    expect(tableRows(w)).toHaveLength(2);
  });

  it("o campo de arquivo aceita vários", async () => {
    const w = await mountView();
    expect(w.find('input[type="file"]').attributes("multiple")).toBeDefined();
  });

  it("um arquivo só continua no fluxo de sempre", async () => {
    detectByName = { "mar.pdf": detectOf({ text: "T-MAR" }) };
    const w = await mountView();
    await pick(w, ["mar.pdf"]);
    expect(w.text()).not.toContain("Importação em lote");
    expect(w.text()).toContain("Arquivo reconhecido");
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("mp");
    expect(detectMock).toHaveBeenCalledTimes(1);
    expect(previewMock).not.toHaveBeenCalled();
  });
});
