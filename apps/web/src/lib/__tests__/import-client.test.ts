import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http", () => ({ http: vi.fn(async () => ({})) }));

import { http } from "../http";
import { bytesToBase64, fileToBase64, decodeText, readFileBytes, formatDate, balanceSummary, detectFile, previewStatement, undoBatch, listBatches, nextCardRef, rowTags } from "../import-client";

const lastCall = () => {
  const calls = vi.mocked(http).mock.calls;
  return (calls[calls.length - 1] ?? []).slice(0, 3);
};

beforeEach(() => vi.mocked(http).mockClear());

describe("bytesToBase64", () => {
  it("codifica bytes, inclusive acima de 32 KB (blocos)", () => {
    expect(bytesToBase64(new Uint8Array([72, 101, 108, 108, 111]))).toBe("SGVsbG8=");
    const big = new Uint8Array(70000).fill(65);
    expect(atob(bytesToBase64(big))).toBe("A".repeat(70000));
  });
});

describe("fileToBase64", () => {
  it("lê o arquivo inteiro sem o prefixo data:", async () => {
    const file = new File(["OFXHEADER:100"], "a.ofx", { type: "application/x-ofx" });
    expect(atob(await fileToBase64(file))).toBe("OFXHEADER:100");
  });
});

describe("balanceSummary", () => {
  it("sem saldos no arquivo", () => {
    expect(balanceSummary(null)).toEqual({ tone: "neutral", text: "O arquivo não traz saldos para conferir." });
  });

  it("saldos conferem", () => {
    expect(balanceSummary({ ok: true, checkedAt: "x", checkpoints: 14, mismatches: [] })).toEqual({
      tone: "ok", text: "Saldos conferem em 14 pontos.",
    });
    expect(balanceSummary({ ok: true, checkedAt: "x", checkpoints: 1, mismatches: [] }).text).toBe("Saldos conferem em 1 ponto.");
  });

  it("divergências, no singular e no plural", () => {
    const m = { dateISO: "2025-10-29", expectedCents: 1, computedCents: 2, diffCents: -1 };
    expect(balanceSummary({ ok: false, checkedAt: "x", checkpoints: 5, mismatches: [m] })).toEqual({
      tone: "warn", text: "1 divergência de saldo em 5 pontos conferidos.",
    });
    expect(balanceSummary({ ok: false, checkedAt: "x", checkpoints: 5, mismatches: [m, m] }).text).toBe(
      "2 divergências de saldo em 5 pontos conferidos.",
    );
  });
});

describe("chamadas à API", () => {
  it("detectFile envia nome e conteúdo em base64", async () => {
    await detectFile(new File(["abc"], "x.ofx"));
    expect(lastCall()).toEqual(["POST", "/import/detect", { fileName: "x.ofx", contentBase64: "YWJj" }]);
  });

  it("previewStatement, undoBatch e listBatches usam as rotas novas", async () => {
    await previewStatement({ accountId: "a1", text: "t", format: "ofx" });
    expect(lastCall()).toEqual(["POST", "/import/preview", { accountId: "a1", text: "t", format: "ofx" }]);
    await undoBatch("b1");
    expect(lastCall()).toEqual(["POST", "/import/b1/undo", {}]);
    await listBatches();
    expect(lastCall()[0]).toBe("GET");
    expect(lastCall()[1]).toBe("/import/batches");
  });
});

describe("decodeText", () => {
  it("decodifica UTF-8", () => {
    expect(decodeText(new TextEncoder().encode("Salário"))).toBe("Salário");
  });

  it("cai para windows-1252 quando o UTF-8 é inválido", () => {
    expect(decodeText(new Uint8Array([0x53, 0x61, 0x6c, 0xe1, 0x72, 0x69, 0x6f]))).toBe("Salário");
  });
});

describe("readFileBytes", () => {
  it("lê os bytes do arquivo", async () => {
    const bytes = await readFileBytes(new File(["abc"], "a.csv"));
    expect(Array.from(bytes)).toEqual([97, 98, 99]);
  });
});

describe("formatDate", () => {
  it("YYYY-MM-DD vira dd/mm/aaaa sem deslocar fuso", () => {
    expect(formatDate("2025-10-29")).toBe("29/10/2025");
  });

  it("timestamp ISO completo passa por Date", () => {
    expect(formatDate("2026-06-10T12:00:00.000Z")).toBe("10/06/2026");
  });
});

describe("fatura em CSV", () => {
  it("previewStatement envia cardRef e format csv_invoice", async () => {
    await previewStatement({ accountId: "a1", text: "t", format: "csv_invoice", cardRef: "1591" });
    expect(lastCall()).toEqual(["POST", "/import/preview", { accountId: "a1", text: "t", format: "csv_invoice", cardRef: "1591" }]);
  });

  it("nextCardRef devolve o primeiro cartão ainda não importado", () => {
    expect(nextCardRef(["1111", "2222"], [])).toBe("1111");
    expect(nextCardRef(["1111", "2222"], ["1111"])).toBe("2222");
    expect(nextCardRef(["1111", "2222"], ["1111", "2222"])).toBeNull();
    expect(nextCardRef([], [])).toBeNull();
  });

  it("rowTags marca parcela e dólar pelo texto da descrição", () => {
    expect(rowTags("Loja X 3/10")).toEqual({ installment: "3/10", usd: false });
    expect(rowTags("Loja X 2/6 (US$ 5.00 @ 5.44)")).toEqual({ installment: "2/6", usd: true });
    expect(rowTags("Apple (US$ 5.00 @ 5.44)")).toEqual({ installment: null, usd: true });
    expect(rowTags("Mercado")).toEqual({ installment: null, usd: false });
    expect(rowTags(null)).toEqual({ installment: null, usd: false });
  });
});
