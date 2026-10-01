import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { themeColors, type ThemeColors } from "./theme-colors";

/**
 * Cores do tema atual como ref reativa: relê as variáveis CSS quando `data-theme` muda em `<html>` (toggle manual)
 * ou quando a preferência do sistema (`prefers-color-scheme`) muda.
 */
export function useThemeColors(): Ref<ThemeColors> {
  const colors = ref<ThemeColors>(themeColors());
  let observer: MutationObserver | null = null;
  let media: MediaQueryList | null = null;
  const refresh = () => {
    colors.value = themeColors();
  };

  onMounted(() => {
    refresh();
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      observer = new MutationObserver(refresh);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener?.("change", refresh);
    }
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    media?.removeEventListener?.("change", refresh);
  });

  return colors;
}
