import { ref } from "vue";

const deferredPrompt = ref<{ prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null>(null);
export const canInstall = ref(false);

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt.value = e as unknown as typeof deferredPrompt.value;
    canInstall.value = true;
  });
  window.addEventListener("appinstalled", () => {
    canInstall.value = false;
    deferredPrompt.value = null;
  });
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt.value) return "unavailable";
  await deferredPrompt.value.prompt();
  const { outcome } = await deferredPrompt.value.userChoice;
  deferredPrompt.value = null;
  canInstall.value = false;
  return outcome as "accepted" | "dismissed";
}
