import { describe, it, expect } from "vitest";
import { ordinalFingerprints, importFingerprint } from "../import";
import {
  parseBrlCents, toISODate, inferYearISO, monthFromName, parsePtLongDate, splitCells,
} from "../parsers/text";
import { verifyBalances } from "../parsers/balance";

describe("ordinalFingerprints", () => {
  it("numera linhas de chave idêntica na ordem do arquivo", () => {
    expect(ordinalFingerprints(["a", "b", "a", "a", "b"])).toEqual(["a|0", "b|0", "a|1", "a|2", "b|1"]);
  });

  it("duas linhas iguais no mesmo dia geram fingerprints diferentes", () => {
    const k = importFingerprint("acc1", "2026-06-10", -2000, "Pix enviado para Padaria");
    const [a, b] = ordinalFingerprints([k, k]);
    expect(a).not.toBe(b);
    expect(a.startsWith(`${k}|`)).toBe(true);
  });

  it("é determinístico entre execuções", () => {
    expect(ordinalFingerprints(["x", "x"])).toEqual(ordinalFingerprints(["x", "x"]));
  });
});

describe("parseBrlCents", () => {
  it("lê valores com e sem sinal, milhar e zero", () => {
    expect(parseBrlCents("R$ 1.234,56")).toBe(123456);
    expect(parseBrlCents("-R$ 500,00")).toBe(-50000);
    expect(parseBrlCents("- R$ 5,00")).toBe(-500);
    expect(parseBrlCents("R$ 0,00")).toBe(0);
    expect(parseBrlCents("-R$ 0,00")).toBe(0);
    expect(parseBrlCents("R$ 12.345.678,90")).toBe(1234567890);
  });

  it("devolve null para o que não é valor", () => {
    expect(parseBrlCents("abc")).toBeNull();
    expect(parseBrlCents("R$ 10")).toBeNull();
    expect(parseBrlCents("")).toBeNull();
  });
});

describe("datas", () => {
  it("toISODate valida o calendário", () => {
    expect(toISODate(2025, 10, 5)).toBe("2025-10-05");
    expect(toISODate(2025, 2, 29)).toBeNull();
    expect(toISODate(2024, 2, 29)).toBe("2024-02-29");
    expect(toISODate(2025, 13, 1)).toBeNull();
  });

  it("inferYearISO escolhe o ano mais próximo do meio do período", () => {
    // lançamento 30/10 dentro de outubro de 2025
    expect(inferYearISO(30, 10, "2025-10-01", "2025-10-31")).toBe("2025-10-30");
    // data contábil 01/11 listada no bloco de outubro
    expect(inferYearISO(1, 11, "2025-10-01", "2025-10-31")).toBe("2025-11-01");
    // lançamento 30/12 listado no bloco de janeiro de 2026
    expect(inferYearISO(30, 12, "2026-01-01", "2026-01-31")).toBe("2025-12-30");
    // contábil 02/01 listado no bloco de dezembro de 2025
    expect(inferYearISO(2, 1, "2025-12-01", "2025-12-31")).toBe("2026-01-02");
  });

  it("inferYearISO recusa datas a mais de 45 dias do bloco", () => {
    expect(inferYearISO(29, 2, "2025-02-01", "2025-02-28")).toBeNull();
    expect(inferYearISO(15, 6, "2025-10-01", "2025-10-31")).toBeNull();
    expect(inferYearISO(10, 1, "2025-12-15", "2026-01-15")).toBe("2026-01-10");
  });

  it("inferYearISO devolve null para dia inexistente", () => {
    expect(inferYearISO(31, 2, "2025-02-01", "2025-02-28")).toBeNull();
  });

  it("monthFromName e parsePtLongDate", () => {
    expect(monthFromName("Março")).toBe(3);
    expect(monthFromName("setembro")).toBe(9);
    expect(monthFromName("xyz")).toBeNull();
    expect(parsePtLongDate("5", "setembro", "2026")).toBe("2026-09-05");
    expect(parsePtLongDate("5", "xyz", "2026")).toBeNull();
  });
});

describe("splitCells", () => {
  it("divide por tabulação (saída do pdf-parse) preservando espaços internos", () => {
    expect(splitCells("19/09 \t19/09 \tEntrada PIX \tPix recebido de A  B \tR$ 500,00")).toEqual([
      "19/09", "19/09", "Entrada PIX", "Pix recebido de A  B", "R$ 500,00",
    ]);
  });

  it("divide por 2+ espaços quando não há tabulação (pdftotext -layout)", () => {
    expect(splitCells("19/09      19/09      Entrada PIX     Pix recebido de A      R$ 500,00")).toEqual([
      "19/09", "19/09", "Entrada PIX", "Pix recebido de A", "R$ 500,00",
    ]);
  });
});

describe("splitCells (células vazias)", () => {
  it("preserva células vazias entre tabulações", () => {
    expect(splitCells("19/09\t\tPix\tR$ 5,00")).toEqual(["19/09", "", "Pix", "R$ 5,00"]);
  });

  it("preserva células vazias nas pontas", () => {
    expect(splitCells("\t19/09\tPix\t")).toEqual(["", "19/09", "Pix", ""]);
  });
});

describe("verifyBalances", () => {
  const row = (type: "income" | "expense", amountCents: number, date: string, postedDate: string | null = null) => ({
    type, amountCents, date, postedDate,
  });
  const NOW = new Date("2026-01-01T00:00:00Z");

  it("devolve null sem pelo menos dois pontos de saldo", () => {
    expect(verifyBalances([], [], NOW)).toBeNull();
    expect(verifyBalances([row("income", 100, "2025-10-01")], [{ dateISO: "2025-10-01", balanceCents: 100 }], NOW)).toBeNull();
  });

  it("confere cada intervalo (anterior, atual] pelo saldo anterior declarado", () => {
    const rows = [row("income", 1000, "2025-10-02"), row("expense", 500, "2025-10-03"), row("expense", 100, "2025-10-05")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-02", balanceCents: 1000 }, // âncora: não verifica nada atrás dela
      { dateISO: "2025-10-04", balanceCents: 500 },
      { dateISO: "2025-10-06", balanceCents: 400 },
    ], NOW);
    expect(check).toEqual({ ok: true, checkedAt: NOW.toISOString(), checkpoints: 2, mismatches: [] });
  });

  it("agrupa pela data contábil, não pela posição nem pela data de lançamento", () => {
    // lançada em 05/10 mas contábil em 03/10: entra no intervalo (02/10, 04/10]
    const rows = [row("expense", 500, "2025-10-05", "2025-10-03")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-02", balanceCents: 1000 },
      { dateISO: "2025-10-04", balanceCents: 500 },
    ], NOW);
    expect(check?.ok).toBe(true);
  });

  it("aceita os pontos fora de ordem e ordena por data", () => {
    const rows = [row("expense", 100, "2025-10-03")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-04", balanceCents: 900 },
      { dateISO: "2025-10-02", balanceCents: 1000 },
    ], NOW);
    expect(check?.ok).toBe(true);
  });

  it("ponto de saldo corrente soma as linhas sem limite superior de data (contábil futura)", () => {
    // lançada em 05/10 (antes/no dia da exportação), contábil em 08/10: já está no saldo corrente
    const rows = [row("expense", 100, "2025-10-03"), row("expense", 50, "2025-10-05", "2025-10-08")];
    const anchor = { dateISO: "2025-10-02", balanceCents: 1000 };
    const current = { dateISO: "2025-10-05", balanceCents: 850 };
    expect(verifyBalances(rows, [anchor, { ...current, current: true }], NOW)?.ok).toBe(true);
    // sem a marca, a linha contábil de 08/10 fica fora de (02/10, 05/10] e há divergência
    const sem = verifyBalances(rows, [anchor, current], NOW);
    expect(sem?.ok).toBe(false);
    expect(sem?.mismatches).toEqual([{ dateISO: "2025-10-05", expectedCents: 850, computedCents: 900, diffCents: -50 }]);
  });

  it("saldo do dia e saldo corrente na mesma data: o corrente vem depois, mesmo se informado antes", () => {
    // 50 lançada em 04/10 mas contábil em 08/10: está no saldo corrente (850), não no saldo do dia 05/10 (900)
    const rows = [row("expense", 100, "2025-10-03"), row("expense", 50, "2025-10-04", "2025-10-08")];
    const anchor = { dateISO: "2025-10-02", balanceCents: 1000 };
    const current = { dateISO: "2025-10-05", balanceCents: 850, current: true };
    const day = { dateISO: "2025-10-05", balanceCents: 900 };
    const check = verifyBalances(rows, [anchor, current, day], NOW);
    expect(check).toEqual({ ok: true, checkedAt: NOW.toISOString(), checkpoints: 2, mismatches: [] });
  });

  it("ponto corrente repetido é deduplicado e checkpoints conta após a deduplicação", () => {
    const rows = [row("expense", 100, "2025-10-03"), row("expense", 50, "2025-10-04", "2025-10-08")];
    const anchor = { dateISO: "2025-10-02", balanceCents: 1000 };
    const current = { dateISO: "2025-10-05", balanceCents: 850, current: true };
    const check = verifyBalances(rows, [anchor, current, { ...current }], NOW);
    expect(check).toEqual({ ok: true, checkedAt: NOW.toISOString(), checkpoints: 1, mismatches: [] });
  });

  it("ponto corrente que não é o último é tratado como ponto comum (limitado pela data)", () => {
    // 50 é contábil em 06/10: fora de (02/10, 05/10]; como o corrente não é o último, não soma sem limite
    const rows = [row("expense", 100, "2025-10-03"), row("expense", 50, "2025-10-04", "2025-10-06")];
    const anchor = { dateISO: "2025-10-02", balanceCents: 1000 };
    const notLast = { dateISO: "2025-10-05", balanceCents: 900, current: true };
    const later = { dateISO: "2025-10-07", balanceCents: 850 };
    const check = verifyBalances(rows, [anchor, notLast, later], NOW);
    expect(check).toEqual({ ok: true, checkedAt: NOW.toISOString(), checkpoints: 2, mismatches: [] });
  });

  it("registra cada divergência com esperado, calculado e diferença (esperado − calculado)", () => {
    const rows = [row("expense", 100, "2025-10-03")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-02", balanceCents: 1000 },
      { dateISO: "2025-10-04", balanceCents: 950 },
    ], NOW);
    expect(check?.ok).toBe(false);
    expect(check?.mismatches).toEqual([{ dateISO: "2025-10-04", expectedCents: 950, computedCents: 900, diffCents: 50 }]);
  });
});
