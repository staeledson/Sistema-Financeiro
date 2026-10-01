import { describe, it, expect, vi, afterEach } from "vitest";
import { routes, scrollBehavior } from "../../router";

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

describe("scrollBehavior", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });
  const call = (hash: string, saved: unknown = null) =>
    (scrollBehavior as any)({ hash }, {}, saved) as ReturnType<typeof scrollBehavior>;

  it("sem hash vai ao topo; com posição salva (voltar) mantém a posição", () => {
    expect(call("")).toEqual({ top: 0 });
    expect(call("#x", { top: 120, left: 0 })).toEqual({ top: 120, left: 0 });
  });

  it("rola até o alvo do hash quando ele já existe", async () => {
    document.body.innerHTML = '<h3 id="sec-cartoes">Cartões</h3>';
    const r = (await call("#sec-cartoes")) as { el: Element };
    expect(r.el.id).toBe("sec-cartoes");
  });

  it("espera o alvo aparecer (seções carregam depois) e desiste sem lançar", async () => {
    vi.useFakeTimers();
    const p = call("#sec-cartoes");
    await vi.advanceTimersByTimeAsync(300);
    document.body.innerHTML = '<h3 id="sec-cartoes">Cartões</h3>';
    await vi.advanceTimersByTimeAsync(200);
    expect(((await p) as { el: Element }).el.id).toBe("sec-cartoes");

    document.body.innerHTML = "";
    const never = call("#nao-existe");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await never).toBe(false);
  });

  it("hash que não é seletor válido não lança", async () => {
    vi.useFakeTimers();
    const p = call("#1 2 ((");
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe(false);
  });
});
