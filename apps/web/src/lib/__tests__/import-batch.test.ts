import { describe, expect, it, vi } from "vitest";
import {
  assignGroup, balanceState, classifyDetected, commitRows, compatibleAccounts, defaultSelected, detectAll, groupUnmatched,
  newRowCount, previewPending, runCommit, shouldRemember, sortChronologically, summarize,
  type BatchAccount, type BatchEntry,
} from "../import-batch";
import type { DetectResponse, PreviewRow, StatementPreview } from "../import-client";

const accounts: BatchAccount[] = [
  { id: "mp", type: "checking", externalId: "12345" },
  { id: "ck2", type: "checking", externalId: null },
  { id: "cc1", type: "credit_card", externalId: "1111" },
  { id: "cc2", type: "credit_card", externalId: null },
];

function detect(over: Partial<DetectResponse> = {}): DetectResponse {
  return {
    format: "pdf_statement", institution: "mercado_pago", kind: "statement", accountRef: "12345", confidence: 1,
    matchedAccountId: "mp", accountRefs: [], matchedAccounts: {}, text: "TEXTO", ...over,
  };
}

function row(n: number, over: Partial<PreviewRow> = {}): PreviewRow {
  return { type: "expense", amountCents: 100 * n, date: "2026-01-0" + n, postedDate: null, description: `Linha ${n}`, fingerprint: `fp${n}`, dup: false, ...over };
}

function prev(over: Partial<StatementPreview> & { rows?: PreviewRow[] } = {}): StatementPreview {
  const rows = over.rows ?? [row(1), row(2)];
  return {
    batchId: "b", institution: "mercado_pago", accountRef: "12345", period: { from: "2026-01-01", to: "2026-01-31" },
    rows, rowCount: rows.length, dupCount: rows.filter((r) => r.dup).length, balanceCheck: null, ...over,
  };
}

function entry(over: Partial<BatchEntry> = {}): BatchEntry {
  return {
    key: "0|", fileIndex: 0, fileName: "a.pdf", format: "pdf_statement", card: false, institution: "mercado_pago", ref: "12345",
    text: "T", accountId: "mp", preview: null, previewError: null, selected: false, result: null, ...over,
  };
}

const file = (name: string) => ({ name });

describe("classifyDetected", () => {
  it("extrato com conta casada vira uma entrada resolvida", () => {
    const r = classifyDetected("a.pdf", 0, detect(), accounts);
    expect(r.unsupported).toBeNull();
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ fileName: "a.pdf", format: "pdf_statement", accountId: "mp", ref: "12345", card: false, text: "TEXTO" });
  });

  it("conta casada que não existe mais ou é incompatível volta a ficar sem conta", () => {
    const gone = classifyDetected("a.pdf", 0, detect({ matchedAccountId: "xx" }), accounts);
    expect(gone.entries[0].accountId).toBeNull();
    const wrongType = classifyDetected("a.ofx", 0, detect({ format: "ofx", kind: "card_invoice", matchedAccountId: "mp" }), accounts);
    expect(wrongType.entries[0].accountId).toBeNull();
    expect(wrongType.entries[0].card).toBe(true);
  });

  it("fatura CSV gera uma entrada por cartão, cada uma com a sua conta casada", () => {
    const r = classifyDetected("fatura.csv", 2, detect({
      format: "csv_invoice", institution: "c6", kind: "card_invoice", accountRef: null, matchedAccountId: null,
      accountRefs: ["1111", "2222"], matchedAccounts: { "1111": "cc1", "2222": null },
    }), accounts);
    expect(r.entries.map((e) => [e.key, e.ref, e.accountId, e.card, e.fileIndex])).toEqual([
      ["2|1111", "1111", "cc1", true, 2],
      ["2|2222", "2222", null, true, 2],
    ]);
  });

  it("formatos que só o fluxo individual trata viram arquivo não suportado com o motivo", () => {
    for (const format of ["csv", "pdf", "unknown"] as const) {
      const r = classifyDetected("x", 0, detect({ format }), accounts);
      expect(r.entries).toEqual([]);
      expect(r.unsupported?.fileName).toBe("x");
      expect(r.unsupported?.reason.length).toBeGreaterThan(10);
    }
    expect(classifyDetected("x", 0, detect({ format: "csv" }), accounts).unsupported?.reason).toMatch(/mapeamento/i);
    expect(classifyDetected("x", 0, detect({ format: "pdf" }), accounts).unsupported?.reason).toMatch(/IA/);
  });

  it("fatura sem cartões e arquivo sem texto também são listados, não descartados", () => {
    expect(classifyDetected("f.csv", 0, detect({ format: "csv_invoice", accountRefs: [] }), accounts).unsupported?.reason).toMatch(/cartões/);
    expect(classifyDetected("f.pdf", 0, detect({ text: null }), accounts).unsupported?.reason).toMatch(/conteúdo/);
  });
});

describe("detectAll", () => {
  it("detecta em sequência, na ordem dos arquivos, e reporta o progresso", async () => {
    const order: string[] = [];
    const fn = vi.fn(async (f: { name: string }) => {
      order.push(`start ${f.name}`);
      await Promise.resolve();
      order.push(`end ${f.name}`);
      return detect();
    });
    const progress: Array<[number, number]> = [];
    const r = await detectAll([file("a"), file("b")], fn, accounts, (i, n) => progress.push([i, n]));
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(r.entries.map((e) => e.fileName)).toEqual(["a", "b"]);
    expect(r.entries.map((e) => e.fileIndex)).toEqual([0, 1]);
  });

  it("um arquivo que falha na leitura vira não suportado com a mensagem e não derruba o lote", async () => {
    const fn = vi.fn(async (f: { name: string }) => {
      if (f.name === "ruim") throw new Error("PDF corrompido");
      return detect({ format: f.name === "gen.csv" ? "csv" : "pdf_statement" });
    });
    const r = await detectAll([file("ok"), file("ruim"), file("gen.csv")], fn, accounts);
    expect(r.entries.map((e) => e.fileName)).toEqual(["ok"]);
    expect(r.unsupported.map((u) => u.fileName)).toEqual(["ruim", "gen.csv"]);
    expect(r.unsupported[0].reason).toContain("PDF corrompido");
  });
});

describe("compatibleAccounts", () => {
  it("fatura só aceita cartão; extrato só aceita conta que não é cartão", () => {
    expect(compatibleAccounts(true, accounts).map((a) => a.id)).toEqual(["cc1", "cc2"]);
    expect(compatibleAccounts(false, accounts).map((a) => a.id)).toEqual(["mp", "ck2"]);
  });
});

describe("groupUnmatched / assignGroup", () => {
  const entries = [
    entry({ key: "0|", fileIndex: 0, fileName: "jan.pdf", ref: "999", accountId: null }),
    entry({ key: "1|", fileIndex: 1, fileName: "fev.pdf", ref: "999", accountId: null }),
    entry({ key: "2|", fileIndex: 2, fileName: "sem-ref.pdf", ref: null, accountId: null }),
    entry({ key: "3|", fileIndex: 3, fileName: "mar.pdf", ref: "12345", accountId: "mp" }),
    entry({ key: "4|1111", fileIndex: 4, fileName: "fat.csv", ref: "1111", card: true, format: "csv_invoice", accountId: null }),
    entry({ key: "4|2222", fileIndex: 4, fileName: "fat.csv", ref: "2222", card: true, format: "csv_invoice", accountId: null }),
  ];

  it("agrupa por ref detectada (ou por arquivo quando não há ref) e ignora o que já tem conta", () => {
    const groups = groupUnmatched(entries);
    expect(groups.map((g) => [g.ref, g.card, g.fileNames, g.entryKeys.length])).toEqual([
      ["999", false, ["jan.pdf", "fev.pdf"], 2],
      [null, false, ["sem-ref.pdf"], 1],
      ["1111", true, ["fat.csv"], 1],
      ["2222", true, ["fat.csv"], 1],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(4);
  });

  it("a mesma ref de extrato e de cartão não se misturam", () => {
    const mixed = [
      entry({ key: "a", ref: "777", accountId: null }),
      entry({ key: "b", ref: "777", accountId: null, card: true, format: "ofx" }),
    ];
    expect(groupUnmatched(mixed)).toHaveLength(2);
  });

  it("escolher uma conta para o grupo resolve todos os arquivos dele de uma vez", () => {
    const [g] = groupUnmatched(entries);
    const next = assignGroup(entries, g.key, "ck2");
    expect(next.filter((e) => e.accountId === "ck2").map((e) => e.fileName)).toEqual(["jan.pdf", "fev.pdf"]);
    expect(next.find((e) => e.fileName === "sem-ref.pdf")?.accountId).toBeNull();
    expect(groupUnmatched(next)).toHaveLength(3);
    // não muta a entrada original
    expect(entries[0].accountId).toBeNull();
  });
});

describe("shouldRemember", () => {
  it("só grava quando a ref é só dígitos, a conta ainda não tem externalId e nenhuma outra conta usa a ref", () => {
    expect(shouldRemember("999", "ck2", accounts)).toBe(true);
    expect(shouldRemember("999", "mp", accounts)).toBe(false); // mp já tem externalId
    expect(shouldRemember("abc-9", "ck2", accounts)).toBe(false);
    expect(shouldRemember(null, "ck2", accounts)).toBe(false);
    expect(shouldRemember("12345", "ck2", accounts)).toBe(false); // outra conta já usa essa ref
    expect(shouldRemember("999", "nope", accounts)).toBe(false);
  });
});

describe("regras de seleção padrão", () => {
  const ok = { ok: true, checkedAt: "2026-01-31", checkpoints: 3, mismatches: [] };
  const bad = { ok: false, checkedAt: "2026-01-31", checkpoints: 3, mismatches: [{ dateISO: "2026-01-10", expectedCents: 1, computedCents: 2, diffCents: 1 }] };

  it("balanceState distingue confere, divergência e sem saldos", () => {
    expect(balanceState(prev({ balanceCheck: ok }))).toBe("ok");
    expect(balanceState(prev({ balanceCheck: bad }))).toBe("mismatch");
    expect(balanceState(prev({ balanceCheck: null }))).toBe("none");
  });

  it("marca quando o saldo confere ou não existe e há ao menos 1 linha nova", () => {
    expect(defaultSelected(prev({ balanceCheck: ok }))).toBe(true);
    expect(defaultSelected(prev({ balanceCheck: null }))).toBe(true);
  });

  it("não marca com divergência de saldo nem quando não há linha nova", () => {
    expect(defaultSelected(prev({ balanceCheck: bad }))).toBe(false);
    const allDup = prev({ rows: [row(1, { dup: true }), row(2, { dup: true })], balanceCheck: ok });
    expect(newRowCount(allDup)).toBe(0);
    expect(defaultSelected(allDup)).toBe(false);
    expect(defaultSelected(prev({ rows: [], balanceCheck: null }))).toBe(false);
  });

  it("newRowCount conta só as linhas que não são duplicadas", () => {
    expect(newRowCount(prev({ rows: [row(1), row(2, { dup: true }), row(3)] }))).toBe(2);
  });
});

describe("previewPending", () => {
  it("pré-visualiza só quem tem conta e ainda não tem preview, aplicando a seleção padrão", async () => {
    const entries = [
      entry({ key: "0|", fileIndex: 0, fileName: "a" }),
      entry({ key: "1|", fileIndex: 1, fileName: "b", accountId: null }),
      entry({ key: "2|", fileIndex: 2, fileName: "c", preview: prev({ batchId: "ja" }), selected: true }),
      entry({ key: "3|", fileIndex: 3, fileName: "d", format: "csv_invoice", card: true, ref: "1111", accountId: "cc1", text: "CSV" }),
    ];
    const fn = vi.fn(async (body: { accountId: string; text: string; format: string; cardRef?: string }) =>
      prev({ batchId: `b-${body.accountId}`, rows: body.cardRef ? [row(1, { dup: true })] : [row(1)] }));
    const out = await previewPending(entries, fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, { accountId: "mp", text: "T", format: "pdf_statement" });
    expect(fn).toHaveBeenNthCalledWith(2, { accountId: "cc1", text: "CSV", format: "csv_invoice", cardRef: "1111" });
    expect(out[0].preview?.batchId).toBe("b-mp");
    expect(out[0].selected).toBe(true);
    expect(out[1].preview).toBeNull();
    expect(out[2].preview?.batchId).toBe("ja");
    expect(out[3].selected).toBe(false); // só duplicadas: "nada novo"
  });

  it("falha de um preview marca só aquela entrada e segue com as outras", async () => {
    const entries = [entry({ key: "0|", fileName: "a" }), entry({ key: "1|", fileIndex: 1, fileName: "b" })];
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("Conta inválida"))
      .mockResolvedValueOnce(prev());
    const out = await previewPending(entries, fn);
    expect(out[0].previewError).toBe("Conta inválida");
    expect(out[0].preview).toBeNull();
    expect(out[0].selected).toBe(false);
    expect(out[1].preview).not.toBeNull();
  });

  it("ofx usa o formato ofx", async () => {
    const fn = vi.fn(async () => prev());
    await previewPending([entry({ format: "ofx" })], fn);
    expect(fn).toHaveBeenCalledWith({ accountId: "mp", text: "T", format: "ofx" });
  });
});

describe("sortChronologically", () => {
  it("ordena pelo início do período, com a ordem dos arquivos como desempate e sem período por último", () => {
    const p = (from: string) => prev({ period: { from, to: from } });
    const es = [
      entry({ key: "a", fileIndex: 0, fileName: "mar", preview: p("2026-03-01") }),
      entry({ key: "b", fileIndex: 1, fileName: "sem", preview: prev({ period: null }) }),
      entry({ key: "c", fileIndex: 2, fileName: "jan", preview: p("2026-01-01") }),
      entry({ key: "d", fileIndex: 3, fileName: "fev-b", preview: p("2026-02-01") }),
      entry({ key: "e", fileIndex: 1, fileName: "fev-a", preview: p("2026-02-01") }),
      entry({ key: "f", fileIndex: 4, fileName: "sem-preview" }),
    ];
    expect(sortChronologically(es).map((e) => e.fileName)).toEqual(["jan", "fev-a", "fev-b", "mar", "sem", "sem-preview"]);
    expect(es[0].fileName).toBe("mar"); // não muta
  });
});

describe("commitRows", () => {
  it("manda só as linhas novas, com conta, categoria e data de lançamento", () => {
    const e = entry({
      accountId: "mp",
      preview: prev({ rows: [row(1, { categoryId: "cat1", postedDate: "2026-01-02" }), row(2, { dup: true }), row(3)] }),
    });
    expect(commitRows(e)).toEqual([
      { type: "expense", amountCents: 100, date: "2026-01-01", postedDate: "2026-01-02", fingerprint: "fp1", description: "Linha 1", accountId: "mp", categoryId: "cat1" },
      { type: "expense", amountCents: 300, date: "2026-01-03", postedDate: null, fingerprint: "fp3", description: "Linha 3", accountId: "mp", categoryId: null },
    ]);
  });
});

describe("runCommit", () => {
  const mk = (name: string, from: string, idx: number, over: Partial<BatchEntry> = {}) =>
    entry({
      key: `${idx}|`, fileIndex: idx, fileName: name, selected: true,
      preview: prev({ batchId: `b-${name}`, period: { from, to: from } }), ...over,
    });

  it("importa só as marcadas, em ordem cronológica, uma de cada vez", async () => {
    const entries = [mk("mar", "2026-03-01", 0), mk("jan", "2026-01-01", 1), mk("fev", "2026-02-01", 2, { selected: false }), mk("abr", "2026-04-01", 3)];
    let running = 0;
    let maxRunning = 0;
    const calls: string[] = [];
    const commit = vi.fn(async (batchId: string, _rows: unknown[]) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      calls.push(batchId);
      await Promise.resolve();
      running--;
      return { inserted: 2, skipped: 1 };
    });
    const r = await runCommit(entries, commit);
    expect(calls).toEqual(["b-jan", "b-mar", "b-abr"]);
    expect(maxRunning).toBe(1);
    expect(r.failed).toBeNull();
    expect(r.remaining).toEqual([]);
    expect(r.done.map((d) => [d.entry.fileName, d.inserted, d.skipped])).toEqual([["jan", 2, 1], ["mar", 2, 1], ["abr", 2, 1]]);
    expect(commit.mock.calls[0][1]).toHaveLength(2); // linhas do commit
  });

  it("para na primeira falha, informa o arquivo e a mensagem e devolve os não processados", async () => {
    const entries = [mk("jan", "2026-01-01", 0), mk("fev", "2026-02-01", 1), mk("mar", "2026-03-01", 2)];
    const commit = vi.fn()
      .mockResolvedValueOnce({ inserted: 5, skipped: 0 })
      .mockRejectedValueOnce(new Error("Lote não encontrado"));
    const r = await runCommit(entries, commit);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(r.done.map((d) => d.entry.fileName)).toEqual(["jan"]);
    expect(r.failed?.entry.fileName).toBe("fev");
    expect(r.failed?.message).toBe("Lote não encontrado");
    expect(r.remaining.map((e) => e.fileName)).toEqual(["mar"]);
  });

  it("entradas já importadas, sem preview ou sem conta ficam de fora; tentar de novo retoma do ponto da falha", async () => {
    const done = mk("jan", "2026-01-01", 0, { result: { inserted: 5, skipped: 0 } });
    const noPreview = entry({ key: "9|", fileName: "x", selected: true, preview: null });
    const fev = mk("fev", "2026-02-01", 1);
    const mar = mk("mar", "2026-03-01", 2);
    const commit = vi.fn(async () => ({ inserted: 1, skipped: 0 }));
    const r = await runCommit([done, noPreview, fev, mar], commit);
    expect(r.done.map((d) => d.entry.fileName)).toEqual(["fev", "mar"]);
  });

  it("chama onProgress antes de cada arquivo", async () => {
    const seen: string[] = [];
    await runCommit([mk("jan", "2026-01-01", 0), mk("fev", "2026-02-01", 1)], async () => ({ inserted: 0, skipped: 0 }), (e, i, n) => seen.push(`${i}/${n} ${e.fileName}`));
    expect(seen).toEqual(["1/2 jan", "2/2 fev"]);
  });
});

describe("summarize", () => {
  it("soma importados e já existentes dos resultados", () => {
    const es = [
      entry({ result: { inserted: 3, skipped: 1 } }),
      entry({ result: null }),
      entry({ result: { inserted: 4, skipped: 0 } }),
    ];
    expect(summarize(es)).toEqual({ files: 2, inserted: 7, skipped: 1 });
  });
});
