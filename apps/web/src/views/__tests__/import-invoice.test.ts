import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const { detectMock, previewMock, listBatchesMock, httpMock, createMock } = vi.hoisted(() => ({
  detectMock: vi.fn(),
  previewMock: vi.fn(),
  listBatchesMock: vi.fn(),
  httpMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock("../../lib/http", async (orig) => ({ ...(await orig<typeof import("../../lib/http")>()), http: httpMock }));
vi.mock("../../lib/import-client", async (orig) => {
  const mod = await orig<typeof import("../../lib/import-client")>();
  return { ...mod, detectFile: detectMock, previewStatement: previewMock, listBatches: listBatchesMock };
});
vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      accounts: {
        ...mod.api.accounts,
        list: vi.fn(async () => [
          { id: "cc1", type: "credit_card", name: "C6 Cartão A", entity: "pf", institution: "c6", externalId: "1111", closingDay: 5, dueDay: 12, creditLimitCents: null, openingBalanceCents: 0, archived: false },
          { id: "ck1", type: "checking", name: "Conta C6", entity: "pf", institution: "c6", externalId: null, closingDay: null, dueDay: null, creditLimitCents: null, openingBalanceCents: 0, archived: false },
        ]),
        create: createMock,
      },
      categories: {
        list: vi.fn(async () => [{ id: "cat1", type: "expense", name: "Restaurantes e delivery", parentId: null, icon: null, color: null, isSystem: true, entity: "both" }]),
      },
    },
  };
});

import ImportView from "../ImportView.vue";

const row = (n: number, over: Record<string, unknown> = {}) => ({
  type: "expense", amountCents: 1000 * n, date: "2026-09-0" + n, postedDate: null, description: `Compra ${n}`,
  fingerprint: `fp${n}`, dup: false, categoryId: null, bankCategory: null, ...over,
});

const invoiceDetect = {
  format: "csv_invoice", institution: "c6", kind: "card_invoice", accountRef: null, confidence: 1,
  matchedAccountId: null, accountRefs: ["1111", "2222"], matchedAccounts: { "1111": "cc1", "2222": null }, text: "CSV",
};

async function mountView() {
  setActivePinia(createPinia());
  const w = mount(ImportView);
  await flushPromises();
  return w;
}

async function pickFile(w: VueWrapper, name = "Fatura.csv") {
  const input = w.find('input[type="file"]');
  Object.defineProperty(input.element, "files", { value: [new File(["x"], name)], configurable: true });
  await input.trigger("change");
  await flushPromises();
}

beforeEach(() => {
  detectMock.mockReset().mockResolvedValue(invoiceDetect);
  previewMock.mockReset();
  listBatchesMock.mockReset().mockResolvedValue([]);
  httpMock.mockReset();
  createMock.mockReset();
});

describe("ImportView: fatura de cartão em CSV", () => {
  it("abre o primeiro cartão, lista só contas de cartão e preseleciona a conta casada", async () => {
    const w = await mountView();
    await pickFile(w);
    expect(w.text()).toContain("Cartão final 1111 (1 de 2)");
    const options = w.findAll("#import-account option").map((o) => o.text());
    expect(options).toContain("C6 Cartão A");
    expect(options).not.toContain("Conta C6");
    expect(options).toContain("Criar cartão");
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("cc1");
  });

  it("Criar cartão cria a conta credit_card com externalId do final e a seleciona", async () => {
    detectMock.mockResolvedValue({ ...invoiceDetect, matchedAccounts: { "1111": null, "2222": null } });
    createMock.mockResolvedValue({ id: "novo", type: "credit_card", name: "Cartão final 1111", entity: "pj", institution: "c6", externalId: "1111", closingDay: 5, dueDay: 12, creditLimitCents: 500000, openingBalanceCents: 0, archived: false });
    const w = await mountView();
    await pickFile(w);
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("");
    await w.find("#import-account").setValue("__new__");
    expect((w.find("#new-card-name").element as HTMLInputElement).value).toBe("Cartão final 1111");
    await w.find("#new-card-entity").setValue("pj");
    await w.find("#new-card-closing").setValue("5");
    await w.find("#new-card-due").setValue("12");
    await w.find("#new-card-limit").setValue("5000");
    await w.find("#new-card-create").trigger("click");
    await flushPromises();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "credit_card", name: "Cartão final 1111", entity: "pj", institution: "c6", externalId: "1111",
      closingDay: 5, dueDay: 12, creditLimitCents: 500000,
    }));
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("novo");
    expect(w.find("#new-card-name").exists()).toBe(false);
  });

  it("percorre os cartões: commit com categoryId, segundo cartão sem pedir o arquivo, resumo no fim", async () => {
    previewMock
      .mockResolvedValueOnce({ batchId: "b1", rows: [row(1, { categoryId: "cat1", bankCategory: "Restaurante / Lanchonete / Bar" }), row(2, { description: "Loja 3/10 (US$ 5.00 @ 5.44)" })], balanceCheck: null })
      .mockResolvedValueOnce({ batchId: "b2", rows: [row(3)], balanceCheck: null });
    httpMock.mockResolvedValueOnce({ inserted: 2, skipped: 0 }).mockResolvedValueOnce({ inserted: 1, skipped: 0 });
    listBatchesMock.mockResolvedValue([]);

    const w = await mountView();
    await pickFile(w);
    const buttons = () => w.findAll("button");
    await buttons().find((b) => b.text() === "Ver preview")!.trigger("click");
    await flushPromises();
    expect(previewMock).toHaveBeenCalledWith({ accountId: "cc1", text: "CSV", format: "csv_invoice", cardRef: "1111" });
    expect(w.text()).toContain("Categoria do banco");
    expect(w.text()).toContain("Sugestão");
    expect(w.text()).toContain("Restaurante / Lanchonete / Bar");
    expect(w.text()).toContain("Restaurantes e delivery");
    expect(w.text()).toContain("parcela 3/10");
    expect(w.text()).toContain("US$");

    await buttons().find((b) => b.text().startsWith("Importar"))!.trigger("click");
    await flushPromises();
    const [method, path, body] = httpMock.mock.calls[0];
    expect([method, path]).toEqual(["POST", "/import/b1/commit"]);
    expect(body.rows.map((r: { categoryId: string | null }) => r.categoryId)).toEqual(["cat1", null]);
    expect(body.rows[0].accountId).toBe("cc1");

    // segundo cartão: volta ao passo de confirmação, sem pedir o arquivo
    expect(detectMock).toHaveBeenCalledTimes(1);
    expect(w.find('input[type="file"]').exists()).toBe(false);
    expect(w.text()).toContain("Cartão final 2222 (2 de 2)");
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("");
    await w.find("#import-account").setValue("cc1");
    await buttons().find((b) => b.text() === "Ver preview")!.trigger("click");
    await flushPromises();
    expect(previewMock).toHaveBeenLastCalledWith({ accountId: "cc1", text: "CSV", format: "csv_invoice", cardRef: "2222" });
    // sem categoria do banco nem sugestão: as colunas não aparecem
    expect(w.text()).not.toContain("Categoria do banco");
    await buttons().find((b) => b.text().startsWith("Importar"))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Concluído");
    expect(w.text()).toContain("2 cartões, 3 transações importadas");
  });

  it("mostra o erro da API no preview e mantém o cartão", async () => {
    previewMock.mockRejectedValue(new Error("o arquivo tem mais de um cartão"));
    const w = await mountView();
    await pickFile(w);
    await w.findAll("button").find((b) => b.text() === "Ver preview")!.trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain("o arquivo tem mais de um cartão");
    expect(w.text()).toContain("Cartão final 1111 (1 de 2)");
  });
});

describe("ImportView: extrato OFX continua no fluxo antigo", () => {
  it("vai direto ao passo de confirmação, com todas as contas e sem fila de cartões", async () => {
    detectMock.mockResolvedValue({
      format: "ofx", institution: "c6", kind: "statement", accountRef: "999", confidence: 1,
      matchedAccountId: "ck1", accountRefs: [], matchedAccounts: {}, text: "OFX",
    });
    previewMock.mockResolvedValue({ batchId: "b9", rows: [row(1)], balanceCheck: null });
    httpMock.mockResolvedValue({ inserted: 1, skipped: 0 });
    const w = await mountView();
    await pickFile(w, "extrato.ofx");
    expect(w.text()).toContain("Arquivo reconhecido");
    expect(w.text()).not.toContain("Cartão final");
    const options = w.findAll("#import-account option").map((o) => o.text());
    expect(options).toContain("C6 Cartão A");
    expect(options).toContain("Conta C6");
    expect(options).not.toContain("Criar cartão");
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("ck1");
    await w.findAll("button").find((b) => b.text() === "Ver preview")!.trigger("click");
    await flushPromises();
    expect(previewMock).toHaveBeenCalledWith({ accountId: "ck1", text: "OFX", format: "ofx" });
    await w.findAll("button").find((b) => b.text().startsWith("Importar"))!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Concluído");
    expect(w.text()).toContain("1 transações importadas");
  });
});

const btn = (w: VueWrapper, label: string) => w.findAll("button").find((b) => b.text() === label);
const importBtn = (w: VueWrapper) => w.findAll("button").find((b) => b.text().startsWith("Importar"));

describe("ImportView: fila de cartões, pular e cancelar", () => {
  it("Pular este cartão no passo de confirmação avança e o resumo lista os pulados", async () => {
    const w = await mountView();
    await pickFile(w);
    await btn(w, "Pular este cartão")!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Cartão final 2222 (2 de 2)");
    expect(previewMock).not.toHaveBeenCalled();
    await btn(w, "Pular este cartão")!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Concluído");
    expect(w.text()).toContain("Nenhum cartão importado");
    expect(w.text()).toContain("Cartões pulados: final 1111, final 2222");
  });

  it("Pular no preview avança para o próximo cartão e o resumo separa importados e pulados", async () => {
    previewMock
      .mockResolvedValueOnce({ batchId: "b1", rows: [row(1)], balanceCheck: null })
      .mockResolvedValueOnce({ batchId: "b2", rows: [row(2)], balanceCheck: null });
    httpMock.mockResolvedValueOnce({ inserted: 1, skipped: 0 });
    const w = await mountView();
    await pickFile(w);
    await btn(w, "Ver preview")!.trigger("click");
    await flushPromises();
    await btn(w, "Pular este cartão")!.trigger("click");
    await flushPromises();
    expect(httpMock).not.toHaveBeenCalled();
    expect(w.text()).toContain("Cartão final 2222 (2 de 2)");
    await w.find("#import-account").setValue("cc1");
    await btn(w, "Ver preview")!.trigger("click");
    await flushPromises();
    await importBtn(w)!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("1 cartão, 1 transações importadas");
    expect(w.text()).toContain("Cartões pulados: final 1111");
  });

  it("Cancelar no preview volta ao passo de confirmação do mesmo cartão, sem pedir o arquivo", async () => {
    previewMock.mockResolvedValue({ batchId: "b1", rows: [row(1)], balanceCheck: null });
    const w = await mountView();
    await pickFile(w);
    await btn(w, "Ver preview")!.trigger("click");
    await flushPromises();
    await btn(w, "Cancelar")!.trigger("click");
    await flushPromises();
    expect(w.find('input[type="file"]').exists()).toBe(false);
    expect(w.text()).toContain("Cartão final 1111 (1 de 2)");
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("cc1");
    expect(detectMock).toHaveBeenCalledTimes(1);
  });

  it("cartão com todas as linhas duplicadas: Importar fica desabilitado e dá para pular", async () => {
    previewMock.mockResolvedValue({ batchId: "b1", rows: [row(1, { dup: true }), row(2, { dup: true })], balanceCheck: null });
    const w = await mountView();
    await pickFile(w);
    await btn(w, "Ver preview")!.trigger("click");
    await flushPromises();
    expect(importBtn(w)!.attributes("disabled")).toBeDefined();
    await btn(w, "Pular este cartão")!.trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Cartão final 2222 (2 de 2)");
  });

  it("Trocar arquivo e Cancelar ficam desabilitados enquanto ocupado", async () => {
    let release!: (v: unknown) => void;
    previewMock.mockReturnValue(new Promise((r) => { release = r; }));
    const w = await mountView();
    await pickFile(w);
    await btn(w, "Ver preview")!.trigger("click");
    await flushPromises();
    expect(btn(w, "Trocar arquivo")!.attributes("disabled")).toBeDefined();
    expect(btn(w, "Pular este cartão")!.attributes("disabled")).toBeDefined();
    release({ batchId: "b1", rows: [row(1)], balanceCheck: null });
    await flushPromises();
    httpMock.mockReturnValue(new Promise(() => {}));
    await importBtn(w)!.trigger("click");
    await flushPromises();
    expect(btn(w, "Cancelar")!.attributes("disabled")).toBeDefined();
    expect(btn(w, "Pular este cartão")!.attributes("disabled")).toBeDefined();
  });
});

describe("ImportView: validações e fatura em OFX", () => {
  it("limite negativo e nome vazio mostram mensagem e não criam o cartão", async () => {
    detectMock.mockResolvedValue({ ...invoiceDetect, matchedAccounts: { "1111": null, "2222": null } });
    const w = await mountView();
    await pickFile(w);
    await w.find("#import-account").setValue("__new__");
    await w.find("#new-card-limit").setValue("-5");
    await w.find("#new-card-create").trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe("O limite não pode ser negativo.");
    await w.find("#new-card-name").setValue("  ");
    await w.find("#new-card-create").trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe("Nome obrigatório.");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("textos de ajuda e erro citam a fatura do cartão C6 em CSV", async () => {
    const w = await mountView();
    expect(w.text()).toContain("fatura do cartão C6 em CSV");
    detectMock.mockResolvedValue({ ...invoiceDetect, format: "unknown", kind: null, accountRefs: [], matchedAccounts: {} });
    await pickFile(w, "x.bin");
    expect(w.find('[role="alert"]').text()).toContain("fatura do cartão C6 em CSV");
  });

  it("OFX de fatura de cartão: só contas de cartão, Criar cartão com a referência do arquivo e sem lembrar conta em conta comum", async () => {
    detectMock.mockResolvedValue({
      format: "ofx", institution: "c6", kind: "card_invoice", accountRef: "555566", confidence: 1,
      matchedAccountId: "ck1", accountRefs: [], matchedAccounts: {}, text: "OFX",
    });
    createMock.mockResolvedValue({ id: "novo", type: "credit_card", name: "Cartão 555566", entity: "pf", institution: "c6", externalId: "555566", closingDay: null, dueDay: null, creditLimitCents: null, openingBalanceCents: 0, archived: false });
    const w = await mountView();
    await pickFile(w, "fatura.ofx");
    const options = w.findAll("#import-account option").map((o) => o.text());
    expect(options).toContain("C6 Cartão A");
    expect(options).not.toContain("Conta C6");
    expect(options).toContain("Criar cartão");
    // a conta casada é corrente, não aparece no seletor: nada selecionado e nenhuma oferta de lembrar
    expect((w.find("#import-account").element as HTMLSelectElement).value).toBe("");
    expect(w.find(".remember").exists()).toBe(false);
    await w.find("#import-account").setValue("__new__");
    await w.find("#new-card-create").trigger("click");
    await flushPromises();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ type: "credit_card", externalId: "555566" }));
    expect(w.text()).not.toContain("Cartão final 555566 (");
  });
});
