<template>
  <div class="accept-page">
    <div class="accept-card">
      <h2>Aceitar convite</h2>

      <div v-if="status === 'loading'" class="status-msg">Verificando convite…</div>

      <div v-else-if="status === 'success'" class="status-msg success">
        <p>Convite aceito! Você agora faz parte do workspace.</p>
        <button class="btn-primary" @click="emit('done')">Ir para o app</button>
      </div>

      <div v-else-if="status === 'error'" class="status-msg error">
        <p>{{ errorMsg }}</p>
        <button class="btn-secondary" @click="emit('done')">Voltar</button>
      </div>

      <div v-else class="status-msg">
        <p>Token de convite não encontrado na URL.</p>
        <button class="btn-secondary" @click="emit('done')">Voltar</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth";

const emit = defineEmits<{ (e: "done"): void }>();

const auth = useAuthStore();
const status = ref<"idle" | "loading" | "success" | "error">("idle");
const errorMsg = ref("");

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return;

  status.value = "loading";
  try {
    const res = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      status.value = "success";
    } else {
      const body = await res.json().catch(() => ({}));
      errorMsg.value = body.message ?? "Erro ao aceitar convite";
      status.value = "error";
    }
  } catch {
    errorMsg.value = "Erro de conexão";
    status.value = "error";
  }
});
</script>

<style scoped>
.accept-page {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: var(--color-bg, #0d0d1a);
}
.accept-card {
  background: var(--color-surface, #1a1a2e);
  border: 1px solid #333; border-radius: 0.75rem;
  padding: 2rem; min-width: 320px; text-align: center;
}
.accept-card h2 { font-size: 1.3rem; font-weight: 600; margin-bottom: 1rem; }
.status-msg { font-size: 0.95rem; color: #ccc; }
.status-msg.success p { color: #4ade80; margin-bottom: 1rem; }
.status-msg.error p { color: #f87171; margin-bottom: 1rem; }
.btn-primary { padding: 0.5rem 1.25rem; background: var(--color-primary, #4f7cff); color: #fff; border: none; border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; }
.btn-secondary { padding: 0.5rem 1.25rem; background: transparent; border: 1px solid #444; color: var(--color-text, #fff); border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; }
</style>
