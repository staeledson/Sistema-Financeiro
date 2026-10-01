<template>
  <div class="shared-entry">
    <div class="shared-card">
      <h2>Lançar por compartilhamento</h2>

      <div v-if="status === 'loading'" class="status-msg">Processando imagem…</div>
      <div v-else-if="status === 'success'" class="status-msg success">
        <p>Rascunho criado! Acesse "Para categorizar" para confirmar.</p>
        <button type="button" class="btn-primary" @click="router.replace('/categorizar')">Abrir Para categorizar</button>
      </div>
      <div v-else-if="status === 'error'" class="status-msg error">
        <p>{{ errorMsg }}</p>
        <button type="button" class="btn-secondary" @click="router.replace('/')">Voltar</button>
      </div>
      <div v-else class="status-msg">
        <p>Nenhuma imagem recebida.</p>
        <button type="button" class="btn-secondary" @click="router.replace('/')">Voltar</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { http } from "../lib/http";

const router = useRouter();

const status = ref<"idle" | "loading" | "success" | "error">("idle");
const errorMsg = ref("");

onMounted(async () => {
  // share_target sends a POST — data is in sessionStorage when redirected as GET for SPAs,
  // but Workbox can intercept. Here we read from URLSearchParams or sessionStorage fallback.
  const params = new URLSearchParams(window.location.search);
  const storedFile = sessionStorage.getItem("shared-image");
  if (!storedFile && !params.has("shared")) return;

  status.value = "loading";

  try {
    // Get upload URL
    const { url: uploadUrl, storagePath } = await http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", {
      ext: "jpg",
      contentType: "image/jpeg",
    });

    // If file is stored as base64 from SW intercept
    if (storedFile) {
      const blob = await fetch(storedFile).then((r) => r.blob());
      await fetch(uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } });
    }

    // Create ingest job
    await http("POST", "/ingest/image", { storagePath });

    sessionStorage.removeItem("shared-image");
    status.value = "success";
  } catch (e: any) {
    errorMsg.value = e.message ?? "Erro";
    status.value = "error";
  }
});
</script>

<style scoped>
.shared-entry { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); }
.shared-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 2rem; min-width: 300px; max-width: calc(100vw - 2rem); text-align: center; }
.shared-card h2 { font-size: 1.2rem; font-weight: 600; margin-bottom: 1rem; }
.status-msg { font-size: 0.95rem; color: var(--text-muted); }
.status-msg.success p { color: var(--c-income); margin-bottom: 1rem; }
.status-msg.error p { color: var(--danger); margin-bottom: 1rem; }
</style>
