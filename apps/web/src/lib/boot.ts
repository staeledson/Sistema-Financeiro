/**
 * Monta o app depois da navegação inicial. Se `isReady` falhar (ex.: erro num guard),
 * registra o erro e monta mesmo assim, para não deixar a página em branco.
 */
export async function mountWhenReady(ready: () => Promise<unknown>, mount: () => void): Promise<void> {
  try {
    await ready();
  } catch (e) {
    console.error("Falha na navegação inicial; abrindo o app mesmo assim.", e);
  }
  mount();
}
