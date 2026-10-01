import { ref, type Ref } from "vue";

export interface Section<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<string>;
  run: () => Promise<void>;
}

/**
 * Estado independente de uma seção carregada por requisição (dados, carregando, erro). Um contador descarta
 * respostas antigas: só a última chamada de `run` atualiza o estado, mesmo que as anteriores terminem depois.
 */
export function useSection<T>(load: () => Promise<T>): Section<T> {
  const data = ref(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref("");
  let seq = 0;

  async function run() {
    const id = ++seq;
    loading.value = true;
    error.value = "";
    try {
      const result = await load();
      if (id !== seq) return;
      data.value = result;
    } catch (e) {
      if (id !== seq) return;
      error.value = e instanceof Error && e.message ? e.message : "Não foi possível carregar.";
    } finally {
      if (id === seq) loading.value = false;
    }
  }

  return { data, loading, error, run };
}
