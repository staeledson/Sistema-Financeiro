import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { authClient } from "../lib/auth-client";
import { clearStoredWorkspace } from "./workspace";

const STORAGE_KEY = "auth-session";

interface StoredSession { token: string; userId: string | null }

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof p.token !== "string" || !p.token) return null;
    return { token: p.token, userId: typeof p.userId === "string" ? p.userId : null };
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* armazenamento indisponível: a sessão vale só nesta aba */
  }
}

export const useAuthStore = defineStore("auth", () => {
  const stored = readStored();
  const token = ref<string | null>(stored?.token ?? null);
  const userId = ref<string | null>(stored?.userId ?? null);
  const isAuthenticated = computed(() => !!token.value);

  async function signIn(email: string, password: string) {
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) throw error;
    const d = data as { session?: { token?: string }; token?: string; user?: { id?: string } } | null;
    token.value = d?.session?.token ?? d?.token ?? null;
    userId.value = d?.user?.id ?? null;
    writeStored(token.value ? { token: token.value, userId: userId.value } : null);
  }

  async function signUp(email: string, password: string, name: string) {
    const { error } = await authClient.signUp.email({ email, password, name });
    if (error) throw error;
  }

  /** Sessão inválida no servidor (401): limpa localmente sem chamar o servidor. */
  function expire() {
    token.value = null;
    userId.value = null;
    writeStored(null);
    clearStoredWorkspace();
  }

  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      expire();
    }
  }

  return { token, userId, isAuthenticated, signIn, signUp, signOut, expire };
});
