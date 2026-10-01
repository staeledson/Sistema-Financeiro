import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useThemeStore } from "../theme";

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: dark && q.includes("dark"), media: q, addEventListener() {}, removeEventListener() {} }));
  window.matchMedia = (globalThis as any).matchMedia;
}

describe("useThemeStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    mockMatchMedia(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("setMode('dark') define data-theme e grava no localStorage", () => {
    const t = useThemeStore();
    t.setMode("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme-mode")).toBe("dark");
  });

  it("setMode('system') remove o atributo", () => {
    const t = useThemeStore();
    t.setMode("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    t.setMode("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(t.mode).toBe("system");
  });

  it("localStorage que lança erro não quebra", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const t = useThemeStore();
    expect(t.mode).toBe("system");
    expect(() => t.setMode("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("restaura o modo salvo ao criar a store", () => {
    localStorage.setItem("theme-mode", "dark");
    const t = useThemeStore();
    expect(t.mode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignora valor salvo inválido", () => {
    localStorage.setItem("theme-mode", "azul");
    expect(useThemeStore().mode).toBe("system");
  });

  it("toggle alterna claro/escuro a partir do modo efetivo", () => {
    const t = useThemeStore();
    t.setMode("light");
    t.toggle();
    expect(t.mode).toBe("dark");
    t.toggle();
    expect(t.mode).toBe("light");
  });

  it("toggle em 'system' parte da preferência do sistema", () => {
    mockMatchMedia(true);
    const t = useThemeStore();
    t.toggle();
    expect(t.mode).toBe("light");

    setActivePinia(createPinia());
    mockMatchMedia(false);
    const t2 = useThemeStore();
    t2.setMode("system");
    t2.toggle();
    expect(t2.mode).toBe("dark");
  });

  it("effective acompanha mudanças do sistema no modo 'system'", () => {
    let listener: ((e: { matches: boolean }) => void) | null = null;
    let dark = false;
    vi.stubGlobal("matchMedia", (q: string) => ({
      get matches() { return dark && q.includes("dark"); },
      media: q,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { listener = cb; },
      removeEventListener() {},
    }));
    window.matchMedia = (globalThis as any).matchMedia;
    const t = useThemeStore();
    expect(t.effective).toBe("light");
    dark = true;
    listener!({ matches: true });
    expect(t.effective).toBe("dark");
    listener!({ matches: false });
    expect(t.effective).toBe("light");
    // modo explícito ignora o sistema
    t.setMode("light");
    listener!({ matches: true });
    expect(t.effective).toBe("light");
  });
});
