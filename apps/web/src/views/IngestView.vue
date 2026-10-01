<script setup lang="ts">
import { ref } from "vue";
import { http } from "../lib/http";

// text
const text = ref("");
const textStatus = ref("");

// image
const imageFile = ref<File | null>(null);
const imageStatus = ref("");

// audio
const mediaRecorder = ref<MediaRecorder | null>(null);
const audioChunks = ref<Blob[]>([]);
const recording = ref(false);
const audioStatus = ref("");

async function submitText() {
  textStatus.value = "Enviando...";
  try {
    const { jobId } = await http<{ jobId: string }>("POST", "/ingest/text", { text: text.value });
    textStatus.value = `Job criado: ${jobId}. Aguarde o processamento.`;
    text.value = "";
  } catch (e) {
    textStatus.value = `Erro: ${(e as Error).message}`;
  }
}

async function submitImage() {
  if (!imageFile.value) return;
  imageStatus.value = "Obtendo URL de upload...";
  try {
    const ext = imageFile.value.name.split(".").pop() ?? "jpg";
    const { url, storagePath } = await http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", { ext, contentType: imageFile.value.type });
    imageStatus.value = "Enviando imagem...";
    await fetch(url, { method: "PUT", body: imageFile.value, headers: { "content-type": imageFile.value.type } });
    const { jobId } = await http<{ jobId: string }>("POST", "/ingest/image", { storagePath });
    imageStatus.value = `Imagem enviada! Job: ${jobId}`;
    imageFile.value = null;
  } catch (e) {
    imageStatus.value = `Erro: ${(e as Error).message}`;
  }
}

async function toggleRecording() {
  if (recording.value) {
    mediaRecorder.value?.stop();
    recording.value = false;
    return;
  }
  audioStatus.value = "Solicitando microfone...";
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mr = new MediaRecorder(stream);
  audioChunks.value = [];
  mr.ondataavailable = (e) => audioChunks.value.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(audioChunks.value, { type: "audio/webm" });
    try {
      audioStatus.value = "Enviando áudio...";
      const { url, storagePath } = await http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", { ext: "webm", contentType: "audio/webm" });
      await fetch(url, { method: "PUT", body: blob, headers: { "content-type": "audio/webm" } });
      const { jobId } = await http<{ jobId: string }>("POST", "/ingest/audio", { storagePath });
      audioStatus.value = `Áudio enviado! Job: ${jobId}`;
    } catch (e) {
      audioStatus.value = `Erro: ${(e as Error).message}`;
    }
  };
  mr.start();
  mediaRecorder.value = mr;
  recording.value = true;
  audioStatus.value = "Gravando... clique para parar";
}
</script>

<template>
  <section class="ingest">
    <h2>Lançar por IA</h2>

    <div class="card">
      <h3>Texto livre</h3>
      <textarea v-model="text" rows="3" placeholder="Ex: paguei 45 no almoço no iFood ontem"></textarea>
      <button type="button" @click="submitText" :disabled="!text.trim()">Enviar para IA</button>
      <p v-if="textStatus" class="status">{{ textStatus }}</p>
    </div>

    <div class="card">
      <h3>Foto de comprovante</h3>
      <input type="file" accept="image/*" @change="(e) => imageFile = (e.target as HTMLInputElement).files?.[0] ?? null" />
      <button type="button" @click="submitImage" :disabled="!imageFile">Enviar imagem</button>
      <p v-if="imageStatus" class="status">{{ imageStatus }}</p>
    </div>

    <div class="card">
      <h3>Voz</h3>
      <button type="button" :class="{ recording, 'btn-danger': recording }" @click="toggleRecording">
        {{ recording ? '⏹ Parar gravação' : '🎤 Gravar' }}
      </button>
      <p v-if="audioStatus" class="status">{{ audioStatus }}</p>
    </div>
  </section>
</template>

<style scoped>
.ingest { padding: calc(var(--space) * 3); max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
h2 { margin-bottom: 0; }
.card { background: var(--surface); border: 1px solid var(--border); padding: calc(var(--space) * 3); border-radius: var(--radius); display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
h3 { margin: 0; font-size: 1rem; }
textarea { resize: vertical; }
button.recording { animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.7 } }
.status { font-size: 0.85rem; color: var(--text-muted); }
</style>
