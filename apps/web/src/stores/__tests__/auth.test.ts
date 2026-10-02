import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../../lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: vi.fn(async () => ({
        data: { session: { token: "tok" }, user: { id: "u1" } },
        error: null,
      })),
    },
    signUp: {
      email: vi.fn(async () => ({ data: null, error: null })),
    },
    signOut: vi.fn(async () => ({ data: null, error: null })),
  },
}));

import { useAuthStore } from "../auth";

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("signIn define o token e o userId", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "senha123!");
    expect(store.token).toBe("tok");
    expect(store.userId).toBe("u1");
    expect(store.isAuthenticated).toBe(true);
  });

  it("signOut limpa o token e o userId", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "senha123!");
    await store.signOut();
    expect(store.token).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });

  it("token persiste no localStorage e volta numa nova instância do store", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "senha123!");
    setActivePinia(createPinia());
    const again = useAuthStore();
    expect(again.token).toBe("tok");
    expect(again.userId).toBe("u1");
  });

  it("expire limpa a sessão sem chamar o servidor", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "senha123!");
    store.expire();
    expect(store.token).toBeNull();
    expect(localStorage.getItem("auth-session")).toBeNull();
  });
});
