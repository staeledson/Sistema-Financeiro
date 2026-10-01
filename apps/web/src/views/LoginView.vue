<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const email = ref("");
const password = ref("");
const nome = ref("");
const erro = ref("");
const criando = ref(false);
const ocupado = ref(false);

function mensagemDe(e: unknown): string {
  const err = e as { message?: string; status?: number };
  if (err.status === 403) return err.message || "Cadastro não permitido para este e-mail.";
  return err.message || "Não foi possível concluir. Tente novamente.";
}

function alternar() {
  criando.value = !criando.value;
  erro.value = "";
}

async function entrar() {
  erro.value = "";
  ocupado.value = true;
  try {
    await auth.signIn(email.value, password.value);
  } catch (e) {
    erro.value = mensagemDe(e);
  } finally {
    ocupado.value = false;
  }
}

async function criarConta() {
  erro.value = "";
  if (!nome.value.trim()) {
    erro.value = "Informe o seu nome.";
    return;
  }
  if (password.value.length < 8) {
    erro.value = "A senha precisa ter pelo menos 8 caracteres.";
    return;
  }
  ocupado.value = true;
  try {
    await auth.signUp(email.value, password.value, nome.value.trim());
    await auth.signIn(email.value, password.value);
  } catch (e) {
    erro.value = mensagemDe(e);
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <main class="login">
    <h1>Finanças IA</h1>
    <input v-if="criando" v-model="nome" type="text" placeholder="Nome" autocomplete="name" />
    <input v-model="email" type="email" placeholder="E-mail" autocomplete="email" />
    <input
      v-model="password"
      type="password"
      placeholder="Senha"
      :autocomplete="criando ? 'new-password' : 'current-password'"
    />
    <button v-if="!criando" type="button" :disabled="ocupado" @click="entrar">Entrar</button>
    <button v-else type="button" :disabled="ocupado" @click="criarConta">Criar conta</button>
    <button type="button" class="btn-secondary" :disabled="ocupado" @click="alternar">
      {{ criando ? "Já tenho conta" : "Criar conta" }}
    </button>
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
