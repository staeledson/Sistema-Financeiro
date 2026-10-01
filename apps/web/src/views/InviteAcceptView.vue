<template>
  <div class="accept-page">
    <div class="accept-card">
      <h2>Aceitar convite</h2>

      <div v-if="status === 'loading'" class="status-msg">Verificando convite…</div>

      <div v-else-if="status === 'success'" class="status-msg success">
        <p>Convite aceito! Você agora faz parte do workspace.</p>
        <button type="button" class="btn-primary" @click="emit('done')">Ir para o app</button>
      </div>

      <div v-else-if="status === 'error'" class="status-msg error">
        <p>{{ errorMsg }}</p>
        <button type="button" class="btn-secondary" @click="emit('done')">Voltar</button>
      </div>

      <div v-else class="status-msg">
        <p>Token de convite não encontrado na URL.</p>
        <button type="button" class="btn-secondary" @click="emit('done')">Voltar</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { http, HttpError } from "../lib/http";

const emit = defineEmits<{ (e: "done"): void }>();

const status = ref<"idle" | "loading" | "success" | "error">("idle");
const errorMsg = ref("");

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return;

  status.value = "loading";
  try {
    await http("POST", "/invitations/accept", { token });
    status.value = "success";
  } catch (e) {
    errorMsg.value = e instanceof HttpError ? e.message : "Erro de conexão";
    status.value = "error";
  }
});
</script>

<style scoped>
.accept-page {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: var(--bg);
}
.accept-card {
  background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 2rem; min-width: 320px; max-width: calc(100vw - 2rem); text-align: center;
}
.accept-card h2 { font-size: 1.3rem; font-weight: 600; margin-bottom: 1rem; }
.status-msg { font-size: 0.95rem; color: var(--text-muted); }
.status-msg.success p { color: var(--c-income); margin-bottom: 1rem; }
.status-msg.error p { color: var(--danger); margin-bottom: 1rem; }
</style>
