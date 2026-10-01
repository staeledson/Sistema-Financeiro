import { describe, it, expect } from "vitest";
import { routes } from "../../router";

const EXPECTED = [
  "/", "/painel", "/contas", "/transacoes", "/importar", "/categorizar", "/regras",
  "/orcamentos", "/metas", "/membros", "/chat", "/lancar", "/lancar/compartilhado", "/insights", "/ajustes",
];

const byPath = (p: string) => routes.find((r) => r.path === p);

describe("rotas do app", () => {
  it.each(EXPECTED)("existe a rota %s", (path) => {
    expect(byPath(path)).toBeDefined();
  });

  it("/lancar/compartilhado usa componente diferente de /lancar e fica fora da casca", async () => {
    const shared = byPath("/lancar/compartilhado") as any;
    const lancar = byPath("/lancar") as any;
    expect(shared.meta?.bare).toBe(true);
    expect(lancar.meta?.bare).toBeUndefined();
    const [a, b] = await Promise.all([shared.component(), lancar.component()]);
    expect(a.default).toBeDefined();
    expect(b.default).toBeDefined();
    expect(a.default).not.toBe(b.default);
  });

  it("rota desconhecida cai em /", () => {
    const fallback = routes.find((r) => r.path.includes("pathMatch")) as any;
    expect(fallback).toBeDefined();
    expect(fallback.redirect).toBe("/");
  });

  it("o roteador resolve o redirecionamento de caminho desconhecido", async () => {
    const { createRouter, createMemoryHistory } = await import("vue-router");
    const r = createRouter({ history: createMemoryHistory(), routes });
    await r.push("/nao-existe/aqui");
    expect(r.currentRoute.value.path).toBe("/");
  });
});
