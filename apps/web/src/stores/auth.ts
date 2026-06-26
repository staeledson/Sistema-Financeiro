import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { authClient } from "../lib/auth-client";

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(null);
  const userId = ref<string | null>(null);
  const isAuthenticated = computed(() => !!token.value);
  const headers = computed(() => ({
    authorization: `Bearer ${token.value ?? ""}`,
    "content-type": "application/json",
  }));

  async function signIn(email: string, password: string) {
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) throw error;
    token.value = (data as any)?.session?.token ?? (data as any)?.token ?? null;
    userId.value = (data as any)?.user?.id ?? null;
  }

  async function signUp(email: string, password: string, name: string) {
    const { error } = await authClient.signUp.email({ email, password, name });
    if (error) throw error;
  }

  async function signOut() {
    await authClient.signOut();
    token.value = null;
    userId.value = null;
  }

  return { token, userId, isAuthenticated, headers, signIn, signUp, signOut };
});
