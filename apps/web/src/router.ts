import { createRouter, createWebHistory, type RouteRecordRaw, type RouterScrollBehavior } from "vue-router";

/**
 * Rotas do app. `meta.bare` renderiza a tela fora da casca (sem barra lateral).
 */
export const routes: RouteRecordRaw[] = [
  { path: "/", name: "inicio", component: () => import("./views/InicioView.vue") },
  { path: "/painel", name: "painel", component: () => import("./views/PainelView.vue") },
  { path: "/contas", name: "contas", component: () => import("./views/AccountsView.vue") },
  { path: "/transacoes", name: "transacoes", component: () => import("./views/TransactionsView.vue") },
  { path: "/importar", name: "importar", component: () => import("./views/ImportView.vue") },
  { path: "/categorizar", name: "categorizar", component: () => import("./views/ReviewView.vue") },
  { path: "/regras", name: "regras", component: () => import("./views/RegrasView.vue") },
  { path: "/orcamentos", name: "orcamentos", component: () => import("./views/BudgetsView.vue") },
  { path: "/metas", name: "metas", component: () => import("./views/GoalsView.vue") },
  { path: "/membros", name: "membros", component: () => import("./views/MembersView.vue") },
  { path: "/chat", name: "chat", component: () => import("./views/ChatView.vue") },
  { path: "/lancar", name: "lancar", component: () => import("./views/IngestView.vue") },
  // Alvo do compartilhamento do PWA (share_target): fora da casca.
  { path: "/lancar/compartilhado", name: "compartilhado", component: () => import("./views/SharedEntryView.vue"), meta: { bare: true } },
  { path: "/insights", name: "insights", component: () => import("./views/InsightsView.vue") },
  { path: "/ajustes", name: "ajustes", component: () => import("./views/AjustesView.vue") },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

/**
 * Rola até o alvo do hash (ex.: `/painel#sec-cartoes`). As seções do Painel entram na página depois de carregar, então
 * tenta de novo por um instante; nunca lança. Sem hash, mantém a posição salva (voltar) ou vai ao topo.
 */
export const scrollBehavior: RouterScrollBehavior = (to, _from, saved) => {
  if (saved) return saved;
  if (!to.hash) return { top: 0 };
  const selector = to.hash;
  return new Promise((resolve) => {
    let tries = 0;
    const attempt = () => {
      let el: Element | null = null;
      try {
        el = document.querySelector(selector);
      } catch {
        /* hash que não é seletor válido: sem alvo */
      }
      if (el) return resolve({ el, top: 8, behavior: "smooth" });
      if (++tries >= 20) return resolve(false);
      setTimeout(attempt, 100);
    };
    attempt();
  });
};

export const router = createRouter({ history: createWebHistory(), routes, scrollBehavior });
