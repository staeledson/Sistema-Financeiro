import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "theme-mode";

function isMode(v: unknown): v is ThemeMode {
  return v === "system" || v === "light" || v === "dark";
}

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isMode(v) ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function apply(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (mode === "system") delete el.dataset.theme;
  else el.dataset.theme = mode;
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>(readStored());
  apply(mode.value);

  // Preferência do sistema como estado reativo: acompanha mudanças do SO no modo "system".
  const systemDark = ref(systemPrefersDark());
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      // Store é singleton: o listener vive junto com a página.
      mq.addEventListener?.("change", (e: MediaQueryListEvent) => {
        systemDark.value = e.matches;
      });
    }
  } catch {
    /* sem matchMedia: assume o valor inicial */
  }

  /** Tema efetivamente em uso (resolve "system" pela preferência do sistema). */
  const effective = computed<"light" | "dark">(() => (mode.value === "system" ? (systemDark.value ? "dark" : "light") : mode.value));

  function setMode(next: ThemeMode) {
    mode.value = next;
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* armazenamento indisponível: o tema vale só nesta sessão */
    }
  }

  function toggle() {
    setMode(effective.value === "dark" ? "light" : "dark");
  }

  return { mode, effective, setMode, toggle };
});
