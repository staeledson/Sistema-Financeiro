<template>
  <div class="ws-switcher">
    <button class="ws-trigger" @click="open = !open">
      {{ active?.name ?? "Workspace" }} ▾
    </button>

    <div v-if="open" class="ws-dropdown">
      <div class="ws-section-title">Workspaces</div>
      <button
        v-for="ws in workspaces"
        :key="ws.id"
        :class="['ws-item', { active: ws.id === activeId }]"
        @click="select(ws.id)"
      >
        <span class="ws-type-badge">{{ ws.type }}</span>
        {{ ws.name }}
      </button>

      <div class="ws-divider" />
      <button class="ws-item ws-create" @click="showCreate = true; open = false">+ Novo workspace</button>
    </div>

    <div v-if="showCreate" class="ws-modal-overlay" @click.self="showCreate = false">
      <div class="ws-modal">
        <h3>Novo workspace</h3>
        <label>Nome
          <input v-model="form.name" placeholder="Ex.: Família Silva" />
        </label>
        <label>Tipo
          <select v-model="form.type">
            <option value="personal">Pessoal</option>
            <option value="family">Família</option>
            <option value="business">PJ / Empresa</option>
          </select>
        </label>
        <div class="ws-modal-actions">
          <button class="btn-secondary" @click="showCreate = false">Cancelar</button>
          <button class="btn-primary" :disabled="creating || !form.name" @click="create">
            {{ creating ? "Criando…" : "Criar" }}
          </button>
        </div>
        <p v-if="createError" class="ws-error">{{ createError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useWorkspaceStore } from "../stores/workspace";
import { storeToRefs } from "pinia";

const store = useWorkspaceStore();
const { workspaces, activeId, active } = storeToRefs(store);

const open = ref(false);
const showCreate = ref(false);
const creating = ref(false);
const createError = ref("");
const form = ref({ name: "", type: "family" });

function select(id: string) {
  store.setActive(id);
  open.value = false;
}

async function create() {
  creating.value = true;
  createError.value = "";
  try {
    const ws = await store.createWorkspace(form.value.type, form.value.name);
    store.setActive(ws.id);
    showCreate.value = false;
    form.value = { name: "", type: "family" };
  } catch (e: any) {
    createError.value = e.message ?? "Erro ao criar workspace";
  } finally {
    creating.value = false;
  }
}

onMounted(() => store.load());
</script>

<style scoped>
.ws-switcher { position: relative; }
.ws-trigger {
  padding: 0.4rem 0.85rem;
  background: rgba(79,124,255,.12);
  border: 1px solid rgba(79,124,255,.3);
  border-radius: 0.4rem;
  color: var(--color-text, #fff);
  cursor: pointer;
  font-size: 0.875rem;
  white-space: nowrap;
}
.ws-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  background: var(--color-surface, #1a1a2e);
  border: 1px solid #333;
  border-radius: 0.6rem;
  padding: 0.5rem;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
.ws-section-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: .05em; color: #666; padding: 0.25rem 0.5rem 0.4rem; }
.ws-item {
  display: flex; align-items: center; gap: 0.5rem;
  width: 100%; text-align: left;
  padding: 0.45rem 0.6rem;
  background: transparent;
  border: none; border-radius: 0.4rem;
  color: var(--color-text, #fff);
  cursor: pointer; font-size: 0.875rem;
}
.ws-item:hover { background: rgba(255,255,255,.05); }
.ws-item.active { background: rgba(79,124,255,.15); color: var(--color-primary, #4f7cff); }
.ws-type-badge {
  font-size: 0.65rem; text-transform: uppercase; letter-spacing: .04em;
  background: rgba(255,255,255,.08); border-radius: 0.25rem;
  padding: 0.1rem 0.35rem; color: #aaa;
}
.ws-divider { height: 1px; background: #333; margin: 0.4rem 0; }
.ws-create { color: var(--color-primary, #4f7cff) !important; }
.ws-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.ws-modal {
  background: var(--color-surface, #1a1a2e);
  border: 1px solid #333; border-radius: 0.75rem;
  padding: 1.5rem; min-width: 320px;
}
.ws-modal h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; }
.ws-modal label { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; font-size: 0.875rem; color: #aaa; }
.ws-modal input, .ws-modal select {
  padding: 0.5rem 0.75rem;
  background: rgba(255,255,255,.05); border: 1px solid #444;
  border-radius: 0.4rem; color: var(--color-text, #fff); font-size: 0.9rem;
}
.ws-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
.btn-primary { padding: 0.45rem 1rem; background: var(--color-primary, #4f7cff); color: #fff; border: none; border-radius: 0.4rem; cursor: pointer; font-size: 0.875rem; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { padding: 0.45rem 1rem; background: transparent; border: 1px solid #444; border-radius: 0.4rem; color: var(--color-text, #fff); cursor: pointer; font-size: 0.875rem; }
.ws-error { margin-top: 0.5rem; color: #f87171; font-size: 0.8rem; }
</style>
