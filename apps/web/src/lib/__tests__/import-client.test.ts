import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http", () => ({ http: vi.fn(async () => ({})) }));

import { http } from "../http";
import { bytesToBase64, fileToBase64, balanceSummary, detectFile, previewStatement, undoBatch, listBatches } from "../import-client";

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
