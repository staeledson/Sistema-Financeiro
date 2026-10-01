<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const email = ref("");
const password = ref("");
const erro = ref("");

async function entrar() {
  erro.value = "";
  try {
    await auth.signIn(email.value, password.value);
  } catch (e) {
    erro.value = (e as Error).message;
  }
}
</script>

<template>
  <main class="login">
    <h1>Finanças IA</h1>
    <input v-model="email" type="email" placeholder="E-mail" autocomplete="email" />
    <input v-model="password" type="password" placeholder="Senha" autocomplete="current-password" />
    <button type="button" @click="entrar">Entrar</button>
    <p v-if="erro" role="alert" class="text-error">{{ erro }}</p>
  </main>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
  max-width: 360px;
  margin: 10vh auto;
  padding: calc(var(--space) * 3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
</style>
