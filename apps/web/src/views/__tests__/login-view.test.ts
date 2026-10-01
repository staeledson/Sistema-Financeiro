import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

const signIn = vi.fn();
const signUp = vi.fn();
vi.mock("../../lib/auth-client", () => ({
  authClient: {
    signIn: { email: (...a: unknown[]) => signIn(...a) },
    signUp: { email: (...a: unknown[]) => signUp(...a) },
    signOut: vi.fn(),
  },
}));

import LoginView from "../LoginView.vue";

describe("LoginView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    signIn.mockReset();
    signUp.mockReset();
    signIn.mockResolvedValue({ data: { session: { token: "t" }, user: { id: "u" } }, error: null });
    signUp.mockResolvedValue({ data: null, error: null });
  });

  it("alterna para criar conta e mostra o campo de nome", async () => {
    const w = mount(LoginView);
    expect(w.find('input[placeholder="Nome"]').exists()).toBe(false);
    await w.findAll("button").find((b) => b.text() === "Criar conta")!.trigger("click");
    expect(w.find('input[placeholder="Nome"]').exists()).toBe(true);
    expect(w.text()).toContain("Já tenho conta");
  });

  it("cria a conta e entra em seguida", async () => {
    const w = mount(LoginView);
    await w.findAll("button").find((b) => b.text() === "Criar conta")!.trigger("click");
    await w.find('input[placeholder="Nome"]').setValue("Stael");
    await w.find('input[placeholder="E-mail"]').setValue("a@example.com");
    await w.find('input[placeholder="Senha"]').setValue("senha-forte-123");
    await w.findAll("button").find((b) => b.text() === "Criar conta")!.trigger("click");
    await flushPromises();
    expect(signUp).toHaveBeenCalledWith({ email: "a@example.com", password: "senha-forte-123", name: "Stael" });
    expect(signIn).toHaveBeenCalled();
  });

  it("valida nome e tamanho da senha antes de chamar a API", async () => {
    const w = mount(LoginView);
    await w.findAll("button").find((b) => b.text() === "Criar conta")!.trigger("click");
    await w.find('input[placeholder="E-mail"]').setValue("a@example.com");
    await w.find('input[placeholder="Senha"]').setValue("curta");
    const botao = () => w.findAll("button").filter((b) => b.text() === "Criar conta")[0];
    await botao().trigger("click");
    expect(w.text()).toContain("Informe o seu nome.");
    await w.find('input[placeholder="Nome"]').setValue("Stael");
    await botao().trigger("click");
    expect(w.text()).toContain("pelo menos 8 caracteres");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("mostra a mensagem de cadastro não permitido (403) e não entra", async () => {
    signUp.mockResolvedValue({ data: null, error: { status: 403, message: "Cadastro não permitido." } });
    const w = mount(LoginView);
    await w.findAll("button").find((b) => b.text() === "Criar conta")!.trigger("click");
    await w.find('input[placeholder="Nome"]').setValue("Intruso");
    await w.find('input[placeholder="E-mail"]').setValue("x@example.com");
    await w.find('input[placeholder="Senha"]').setValue("senha-forte-123");
    await w.findAll("button").filter((b) => b.text() === "Criar conta")[0].trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Cadastro não permitido.");
    expect(signIn).not.toHaveBeenCalled();
  });
});
