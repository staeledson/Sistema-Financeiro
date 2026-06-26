import { describe, it, expect } from "vitest";
import { parseBrDate, parseAmountCents, importFingerprint, csvRowToTransaction } from "../import";

describe("import helpers", () => {
  it("parseBrDate DD/MM/YYYY → ISO", () => {
    expect(parseBrDate("05/06/2026", "DD/MM/YYYY")).toBe("2026-06-05");
  });

  it("parseBrDate YYYY-MM-DD passthrough", () => {
    expect(parseBrDate("2026-06-05", "YYYY-MM-DD")).toBe("2026-06-05");
  });

  it("parseBrDate MM/DD/YYYY → ISO", () => {
    expect(parseBrDate("06/05/2026", "MM/DD/YYYY")).toBe("2026-06-05");
  });

  it("parseAmountCents com vírgula decimal", () => {
    expect(parseAmountCents("-1.234,56", ",")).toBe(-123456);
  });

  it("parseAmountCents com ponto decimal", () => {
    expect(parseAmountCents("-1,234.56", ".")).toBe(-123456);
  });

  it("fingerprint é estável e normaliza descrição", () => {
    const a = importFingerprint("acc1", "2026-06-05", -3500, "  iFood   SP ");
    const b = importFingerprint("acc1", "2026-06-05", -3500, "ifood sp");
    expect(a).toBe(b);
  });

  it("fingerprint varia por valor", () => {
    const a = importFingerprint("acc1", "2026-06-05", -3500);
    const b = importFingerprint("acc1", "2026-06-05", -3501);
    expect(a).not.toBe(b);
  });

  it("csvRowToTransaction mapeia despesa (negativo → expense)", () => {
    const tx = csvRowToTransaction(
      { Data: "05/06/2026", Valor: "-35,00", Hist: "iFood" },
      {
        dateColumn: "Data",
        amountColumn: "Valor",
        descriptionColumn: "Hist",
        dateFormat: "DD/MM/YYYY",
        decimalSeparator: ",",
        expenseIsNegative: true,
      },
      "acc1",
    );
    expect(tx.type).toBe("expense");
    expect(tx.amountCents).toBe(3500);
    expect(tx.date).toBe("2026-06-05");
    expect(tx.description).toBe("iFood");
    expect(tx.fingerprint).toBe("acc1|2026-06-05|-3500|ifood");
  });

  it("csvRowToTransaction mapeia receita (positivo → income)", () => {
    const tx = csvRowToTransaction(
      { Data: "05/06/2026", Valor: "1.000,00" },
      {
        dateColumn: "Data",
        amountColumn: "Valor",
        dateFormat: "DD/MM/YYYY",
        decimalSeparator: ",",
        expenseIsNegative: true,
      },
      "acc1",
    );
    expect(tx.type).toBe("income");
    expect(tx.amountCents).toBe(100000);
  });
});
