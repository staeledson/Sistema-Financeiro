import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { defineComponent, h } from "vue";

/**
 * Placeholder temporário de `/ajustes`: a AjustesView real chega na Task 11.
 * Texto no mesmo tom do EmptyState (Task 9).
 */
const AjustesPlaceholder = defineComponent({
  name: "AjustesPlaceholder",
  setup() {
    return () =>
      h("section", { style: "padding: 24px; max-width: 720px" }, [
        h("h2", { style: "margin-bottom: 8px" }, "Ajustes"),
        h("p", { style: "color: var(--text-muted)" }, "Em breve: tema, workspace e preferências do app."),
      ]);
  },
});

/**
 * Rotas do app. `meta.bare` renderiza a tela fora da casca (sem barra lateral).
 * `/` e `/painel` apontam para a DashboardView atual até as Tasks 10 (PainelView) e 11 (InicioView).
 */
export const routes: RouteRecordRaw[] = [
  { path: "/", name: "inicio", component: () => import("./views/DashboardView.vue") },
  { path: "/painel", name: "painel", component: () => import("./views/DashboardView.vue") },
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
  { path: "/ajustes", name: "ajustes", component: AjustesPlaceholder },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(), routes });
