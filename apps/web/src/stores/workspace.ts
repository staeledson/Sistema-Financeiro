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

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<WorkspaceInfo[]>([]);
  const activeId = ref<string | null>(null);
  const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) ?? workspaces.value[0] ?? null);

  async function load() {
    const auth = useAuthStore();
    if (!auth.token) return;
    workspaces.value = await http<WorkspaceInfo[]>("GET", "/workspaces");
    if (!activeId.value && workspaces.value.length) {
      activeId.value = workspaces.value[0].id;
    }
  }

  function setActive(id: string) {
    activeId.value = id;
  }

  async function createWorkspace(type: string, name: string) {
    const ws = await http<WorkspaceInfo>("POST", "/workspaces", { type, name });
    workspaces.value.push(ws);
    return ws;
  }

  return { workspaces, activeId, active, load, setActive, createWorkspace };
});
