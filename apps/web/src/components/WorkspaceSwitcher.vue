<template>
  <div class="ws-switcher">
    <button class="ws-trigger" type="button" @click="open = !open">
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
          <button class="btn-secondary" type="button" @click="showCreate = false">Cancelar</button>
          <button class="btn-primary" type="button" :disabled="creating || !form.name" @click="create">
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

onMounted(() => store.load().catch(() => {}));
</script>

<style scoped>
.ws-switcher { position: relative; }
.ws-trigger {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--text);
  font-size: 0.875rem;
  white-space: nowrap;
}
.ws-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space);
  z-index: 100;
  box-shadow: var(--shadow);
}
.ws-section-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); padding: 0.25rem 0.5rem 0.4rem; }
.ws-item {
  display: flex; align-items: center; gap: var(--space);
  width: 100%; text-align: left;
  background: transparent;
  border-color: transparent;
  color: var(--text);
  font-size: 0.875rem;
}
.ws-item:hover { background: var(--surface-2); }
.ws-item.active { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
.ws-type-badge {
  font-size: 0.65rem; text-transform: uppercase; letter-spacing: .04em;
  background: var(--surface-2); border-radius: 0.25rem;
  padding: 0.1rem 0.35rem; color: var(--text-muted);
}
.ws-divider { height: 1px; background: var(--border); margin: 0.4rem 0; }
.ws-create { color: var(--accent); }
.ws-modal-overlay {
  position: fixed; inset: 0; background: var(--scrim);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.ws-modal {
  background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.5rem; min-width: 320px;
}
.ws-modal h3 { font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; }
.ws-modal label { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; font-size: 0.875rem; color: var(--text-muted); }
.ws-modal-actions { display: flex; justify-content: flex-end; gap: var(--space); margin-top: 1rem; }
.ws-error { margin-top: 0.5rem; color: var(--danger); font-size: 0.8rem; }
</style>
