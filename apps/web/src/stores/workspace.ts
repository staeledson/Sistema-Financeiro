import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./auth";

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

  function headers(extra?: Record<string, string>) {
    const auth = useAuthStore();
    const h: Record<string, string> = { authorization: `Bearer ${auth.token}`, "content-type": "application/json" };
    if (activeId.value) h["x-workspace-id"] = activeId.value;
    return { ...h, ...extra };
  }

  async function load() {
    const auth = useAuthStore();
    if (!auth.token) return;
    const res = await fetch("/api/workspaces", { headers: { authorization: `Bearer ${auth.token}` } });
    if (res.ok) {
      workspaces.value = await res.json();
      if (!activeId.value && workspaces.value.length) {
        activeId.value = workspaces.value[0].id;
      }
    }
  }

  function setActive(id: string) {
    activeId.value = id;
  }

  async function createWorkspace(type: string, name: string) {
    const auth = useAuthStore();
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify({ type, name }),
    });
    if (!res.ok) throw new Error(await res.text());
    const ws = await res.json();
    workspaces.value.push(ws);
    return ws;
  }

  return { workspaces, activeId, active, headers, load, setActive, createWorkspace };
});
