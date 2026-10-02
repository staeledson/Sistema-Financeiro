import { describe, it, expect } from "vitest";
import { reserveDirection } from "../reserve";

describe("reserveDirection", () => {
  it("guardar na reserva (despesa) vai para a reserva", () => {
    expect(reserveDirection("expense", "Reserva por gastos Reserva Emergência")).toBe("to_reserve");
    expect(reserveDirection("expense", "Reserva programada Reserva Emergência")).toBe("to_reserve");
  });

  it("retirar da reserva (receita) vem da reserva", () => {
    expect(reserveDirection("income", "Dinheiro retirado Reserva Emergência")).toBe("from_reserve");
  });

  it("ignora maiúsculas, acentos e espaços nas pontas", () => {
    expect(reserveDirection("expense", "  RESERVA POR GASTOS Reserva Emergencia ")).toBe("to_reserve");
    expect(reserveDirection("income", "dinheiro retirado reserva emergência")).toBe("from_reserve");
  });

  it("o sentido precisa bater com o texto", () => {
    expect(reserveDirection("income", "Reserva por gastos Reserva Emergência")).toBeNull();
    expect(reserveDirection("expense", "Dinheiro retirado Reserva Emergência")).toBeNull();
  });

  it("outros lançamentos não são reserva", () => {
    expect(reserveDirection("expense", "Pix enviado para ALINE LOPES MELO")).toBeNull();
    expect(reserveDirection("income", "Rendimentos")).toBeNull();
    expect(reserveDirection("expense", "Pagamento da reserva de hotel")).toBeNull();
    expect(reserveDirection("expense", null)).toBeNull();
    expect(reserveDirection("expense", "")).toBeNull();
  });
});
