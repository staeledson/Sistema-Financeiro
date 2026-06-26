import { ref, onMounted } from "vue";
import * as cache from "./cache";

export function useOfflineData<T>(cacheKey: string, fetcher: () => Promise<T>, fallback: T) {
  const data = ref<T>(fallback);
  const offline = ref(false);

  async function load() {
    if (!navigator.onLine) {
      offline.value = true;
      const cached = await cache.get<T>(cacheKey);
      if (cached !== undefined) data.value = cached;
      return;
    }
    try {
      const fresh = await fetcher();
      data.value = fresh;
      await cache.put(cacheKey, fresh);
      offline.value = false;
    } catch {
      offline.value = true;
      const cached = await cache.get<T>(cacheKey);
      if (cached !== undefined) data.value = cached;
    }
  }

  onMounted(load);
  return { data, offline, reload: load };
}
