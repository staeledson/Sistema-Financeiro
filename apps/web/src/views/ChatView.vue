<template>
  <div class="chat-layout">
    <aside class="chat-sidebar">
      <div class="sidebar-header">
        <span>Conversas</span>
        <button class="btn-icon" title="Nova conversa" @click="newConversation">+</button>
      </div>
      <div v-if="loadingList" class="sidebar-empty">Carregando…</div>
      <div v-else-if="!conversations.length" class="sidebar-empty">Nenhuma conversa ainda.</div>
      <button
        v-for="conv in conversations"
        :key="conv.id"
        :class="['conv-item', { active: activeId === conv.id }]"
        @click="loadConversation(conv.id)"
      >
        {{ conv.title || "Sem título" }}
        <span class="conv-date">{{ conv.createdAt.slice(0, 10) }}</span>
      </button>
    </aside>

    <div class="chat-main">
      <div class="messages" ref="messagesEl">
        <div v-if="!messages.length && !activeId" class="welcome-msg">
          <h3>Pergunte às suas finanças</h3>
          <p>Ex.: "Quanto gastei em alimentação este mês?" ou "Como está meu saldo?"</p>
          <div class="suggestions">
            <button v-for="s in suggestions" :key="s" class="suggestion" @click="input = s">{{ s }}</button>
          </div>
        </div>

        <template v-for="msg in messages" :key="msg.id ?? msg._tmp">
          <div :class="['bubble', msg.role]">
            <div class="bubble-text" v-html="formatText(msg.content)" />
            <ChatChart v-if="msg.chartSpec" :spec="msg.chartSpec" class="bubble-chart" />
          </div>
        </template>

        <div v-if="thinking" class="bubble assistant thinking">
          <span class="dot" /><span class="dot" /><span class="dot" />
        </div>
      </div>

      <form class="chat-input-row" @submit.prevent="send">
        <textarea
          v-model="input"
          class="chat-input"
          rows="1"
          placeholder="Pergunte algo sobre suas finanças…"
          @keydown.enter.exact.prevent="send"
        />
        <button type="submit" class="btn-send" :disabled="thinking || !input.trim()">Enviar</button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue";
import { useWorkspaceStore } from "../stores/workspace";
import ChatChart from "../components/ChatChart.vue";

const wsStore = useWorkspaceStore();

interface ConvSummary { id: string; title: string; createdAt: string; }
interface Message { id?: string; _tmp?: number; role: string; content: string; chartSpec?: any; }

const conversations = ref<ConvSummary[]>([]);
const messages = ref<Message[]>([]);
const activeId = ref<string | null>(null);
const input = ref("");
const thinking = ref(false);
const loadingList = ref(false);
const messagesEl = ref<HTMLDivElement | null>(null);

const suggestions = [
  "Como está meu saldo?",
  "Quanto gastei por categoria este mês?",
  "Mostre meu fluxo de caixa dos últimos 6 meses",
  "Quais foram meus maiores gastos em junho?",
];

async function loadList() {
  loadingList.value = true;
  try {
    const res = await fetch("/api/chat", { headers: wsStore.headers() });
    if (res.ok) conversations.value = await res.json();
  } finally {
    loadingList.value = false;
  }
}

async function loadConversation(id: string) {
  activeId.value = id;
  messages.value = [];
  const res = await fetch(`/api/chat/${id}`, { headers: wsStore.headers() });
  if (res.ok) {
    const { messages: msgs } = await res.json();
    messages.value = msgs;
    scrollDown();
  }
}

function newConversation() {
  activeId.value = null;
  messages.value = [];
  input.value = "";
}

async function send() {
  const text = input.value.trim();
  if (!text || thinking.value) return;
  input.value = "";

  const tmpId = Date.now();
  messages.value.push({ _tmp: tmpId, role: "user", content: text });
  thinking.value = true;
  scrollDown();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: wsStore.headers(),
      body: JSON.stringify({ message: text, conversationId: activeId.value ?? undefined }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    activeId.value = data.conversationId;
    messages.value.push({ role: "assistant", content: data.answer, chartSpec: data.chart });
    await loadList();
  } catch (e: any) {
    messages.value.push({ role: "assistant", content: `Erro: ${e.message}` });
  } finally {
    thinking.value = false;
    scrollDown();
  }
}

function formatText(text: string) {
  return text.replace(/\n/g, "<br>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function scrollDown() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

onMounted(loadList);
</script>

<style scoped>
.chat-layout { display: flex; height: calc(100vh - 57px); overflow: hidden; }
.chat-sidebar {
  width: 240px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid #222;
  background: var(--color-surface, #1a1a2e);
}
.sidebar-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.85rem 1rem; font-size: 0.85rem; font-weight: 600;
  border-bottom: 1px solid #222; color: #aaa;
}
.btn-icon { background: transparent; border: 1px solid #444; border-radius: 0.35rem; color: #fff; width: 24px; height: 24px; cursor: pointer; font-size: 1rem; }
.sidebar-empty { padding: 1rem; font-size: 0.8rem; color: #666; text-align: center; }
.conv-item {
  display: flex; flex-direction: column; align-items: flex-start;
  width: 100%; padding: 0.6rem 1rem;
  background: transparent; border: none; border-bottom: 1px solid #1e1e2e;
  color: var(--color-text, #fff); cursor: pointer; font-size: 0.8rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
}
.conv-item:hover { background: rgba(255,255,255,.04); }
.conv-item.active { background: rgba(79,124,255,.12); color: var(--color-primary, #4f7cff); }
.conv-date { font-size: 0.7rem; color: #555; margin-top: 2px; }

.chat-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.messages { flex: 1; overflow-y: auto; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
.welcome-msg { text-align: center; margin: auto; color: #888; max-width: 480px; }
.welcome-msg h3 { font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem; color: #ccc; }
.welcome-msg p { font-size: 0.875rem; margin-bottom: 1.5rem; }
.suggestions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.suggestion {
  padding: 0.4rem 0.85rem; background: rgba(79,124,255,.1);
  border: 1px solid rgba(79,124,255,.3); border-radius: 1rem;
  color: var(--color-primary, #4f7cff); cursor: pointer; font-size: 0.8rem;
}

.bubble { max-width: 72%; }
.bubble.user { align-self: flex-end; }
.bubble.assistant { align-self: flex-start; }
.bubble-text {
  padding: 0.7rem 1rem; border-radius: 1rem; font-size: 0.9rem; line-height: 1.55;
}
.bubble.user .bubble-text {
  background: var(--color-primary, #4f7cff); color: #fff;
  border-bottom-right-radius: 0.2rem;
}
.bubble.assistant .bubble-text {
  background: var(--color-surface, #1a1a2e); border: 1px solid #333;
  border-bottom-left-radius: 0.2rem;
}
.bubble-chart { margin-top: 0.5rem; border-radius: 0.6rem; overflow: hidden; border: 1px solid #333; }
.thinking { display: flex; align-items: center; gap: 6px; padding: 0.6rem 1rem; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #555; animation: blink 1.2s infinite; }
.dot:nth-child(2) { animation-delay: .2s; }
.dot:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%,80%,100% { opacity: .3 } 40% { opacity: 1 } }

.chat-input-row {
  display: flex; gap: 0.5rem; padding: 0.85rem 1rem;
  border-top: 1px solid #222; background: var(--color-surface, #1a1a2e);
}
.chat-input {
  flex: 1; resize: none; padding: 0.6rem 0.85rem;
  background: rgba(255,255,255,.05); border: 1px solid #333; border-radius: 0.6rem;
  color: var(--color-text, #fff); font-size: 0.9rem; line-height: 1.4;
  max-height: 120px; overflow-y: auto;
}
.btn-send {
  padding: 0.6rem 1.2rem; background: var(--color-primary, #4f7cff); color: #fff;
  border: none; border-radius: 0.6rem; cursor: pointer; font-size: 0.875rem;
  white-space: nowrap;
}
.btn-send:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
