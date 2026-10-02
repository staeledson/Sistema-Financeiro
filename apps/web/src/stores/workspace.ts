import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./auth";
import { http } from "../lib/http";

export interface WorkspaceInfo {
  id: string;
  type: string;
  name: string;
  currency: string;
}

const STORAGE_KEY = "workspace-active";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<WorkspaceInfo[]>([]);
  const activeId = ref<string | null>(readStored());
  const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) ?? workspaces.value[0] ?? null);

  async function load() {
    const auth = useAuthStore();
    if (!auth.token) return;
    workspaces.value = await http<WorkspaceInfo[]>("GET", "/workspaces");
    // id salvo que não existe mais (removido do workspace, outro usuário no mesmo navegador) cai no primeiro
    if (!workspaces.value.some((w) => w.id === activeId.value)) {
      setActive(workspaces.value[0]?.id ?? null);
    }
  }

  function setActive(id: string | null) {
    activeId.value = id;
    writeStored(id);
  }

  async function createWorkspace(type: string, name: string) {
    const ws = await http<WorkspaceInfo>("POST", "/workspaces", { type, name });
    workspaces.value.push(ws);
    return ws;
  }

  return { workspaces, activeId, active, load, setActive, createWorkspace };
});
