<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import LoginView from "./views/LoginView.vue";
import InviteAcceptView from "./views/InviteAcceptView.vue";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher.vue";
import { useAuthStore } from "./stores/auth";
import { useWorkspaceStore } from "./stores/workspace";
import { useThemeStore } from "./stores/theme";
import { canInstall, promptInstall } from "./pwa/install";

const auth = useAuthStore();
const wsStore = useWorkspaceStore();
const theme = useThemeStore();
const route = useRoute();
const router = useRouter();

interface NavItem { to: string; label: string }
interface NavGroup { title?: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { title: "Visão", items: [{ to: "/", label: "Início" }, { to: "/painel", label: "Painel" }] },
  {
    title: "Lançamentos",
    items: [
      { to: "/transacoes", label: "Transações" },
      { to: "/categorizar", label: "Para categorizar" },
      { to: "/importar", label: "Importar" },
      { to: "/lancar", label: "Lançar por IA" },
    ],
  },
  {
    title: "Planejamento",
    items: [{ to: "/orcamentos", label: "Orçamentos" }, { to: "/metas", label: "Metas" }, { to: "/insights", label: "Insights" }],
  },
  {
    title: "Cadastros",
    items: [{ to: "/contas", label: "Contas" }, { to: "/regras", label: "Regras" }, { to: "/membros", label: "Membros" }, { to: "/ajustes", label: "Ajustes" }],
  },
  { items: [{ to: "/chat", label: "Chat IA" }] },
];

const BOTTOM: NavItem[] = [
  { to: "/", label: "Início" },
  { to: "/painel", label: "Painel" },
  { to: "/lancar", label: "Lançar" },
  { to: "/chat", label: "Chat" },
];
const BOTTOM_PATHS = BOTTOM.map((b) => b.to);

const inviteToken = computed(() => {
  const t = route.query.token;
  return typeof t === "string" && t ? t : null;
});
// Tela fora da casca (ex.: alvo do compartilhamento do PWA).
const isBare = computed(() => route.meta.bare === true);
const moreActive = computed(() => !BOTTOM_PATHS.includes(route.path));
const themeLabel = computed(() => (theme.effective === "dark" ? "Tema claro" : "Tema escuro"));

onMounted(() => {
  if (auth.isAuthenticated) void wsStore.load().catch(() => {});
});

function onInviteAcceptDone() {
  const { token: _token, ...rest } = route.query;
  void router.replace({ path: route.path, query: rest });
  void wsStore.load().catch(() => {});
}
</script>

<template>
  <RouterView v-if="auth.isAuthenticated && isBare" />
  <InviteAcceptView v-else-if="auth.isAuthenticated && inviteToken" @done="onInviteAcceptDone" />
  <LoginView v-else-if="!auth.isAuthenticated" />

  <div v-else class="shell">
    <aside class="sidebar">
      <RouterLink to="/" class="logo">Finanças</RouterLink>

      <nav class="side-nav" aria-label="Navegação principal">
        <div v-for="(group, i) in NAV" :key="group.title ?? i" class="nav-group">
          <span v-if="group.title" class="nav-title">{{ group.title }}</span>
          <RouterLink v-for="item in group.items" :key="item.to" :to="item.to" class="nav-link">{{ item.label }}</RouterLink>
        </div>
      </nav>

      <div class="sidebar-footer">
        <WorkspaceSwitcher />
        <button class="foot-btn" type="button" @click="theme.toggle()">{{ themeLabel }}</button>
        <button v-if="canInstall" class="foot-btn" type="button" @click="promptInstall()">Instalar app</button>
        <button class="foot-btn" type="button" @click="auth.signOut()">Sair</button>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>

    <nav class="bottom-nav" aria-label="Navegação rápida">
      <RouterLink v-for="item in BOTTOM" :key="item.to" :to="item.to" class="bn-link">{{ item.label }}</RouterLink>
      <RouterLink to="/contas" class="bn-link" :class="{ 'router-link-active': moreActive }">Mais</RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }

.sidebar {
  width: 232px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 30;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
  padding: calc(var(--space) * 2);
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.logo {
  font-weight: 700;
  font-size: 1.15rem;
  color: var(--text);
  text-decoration: none;
  padding: var(--space) calc(var(--space) * 1.5);
}

.side-nav { display: flex; flex-direction: column; gap: calc(var(--space) * 2); flex: 1; }
.nav-group { display: flex; flex-direction: column; gap: 2px; }
.nav-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  padding: 0 calc(var(--space) * 1.5) calc(var(--space) * 0.5);
}
.nav-link {
  display: block;
  padding: calc(var(--space) * 0.9) calc(var(--space) * 1.5);
  border-radius: calc(var(--radius) / 1.5);
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.92rem;
}
.nav-link:hover { background: var(--surface-2); color: var(--text); }
.nav-link.router-link-exact-active { background: var(--surface-2); color: var(--accent); font-weight: 600; }

.sidebar-footer { display: flex; flex-direction: column; gap: var(--space); padding-top: calc(var(--space) * 2); border-top: 1px solid var(--border); }
.sidebar-footer :deep(.ws-switcher) { position: relative; }
.sidebar-footer :deep(.ws-trigger) { width: 100%; text-align: left; color: var(--text); background: var(--surface-2); border: 1px solid var(--border); }
.sidebar-footer :deep(.ws-dropdown) { top: auto; bottom: calc(100% + 6px); left: 0; right: auto; min-width: 100%; }
.foot-btn {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  font-size: 0.85rem;
  text-align: left;
}
.foot-btn:hover { background: var(--surface-2); color: var(--text); }

.main { flex: 1; min-width: 0; }

.bottom-nav {
  display: none;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 20;
}
.bn-link {
  flex: 1;
  text-align: center;
  padding: calc(var(--space) * 1.5) var(--space);
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.78rem;
}
.bn-link.router-link-exact-active,
.bn-link.router-link-active:not([href="/"]) { color: var(--accent); font-weight: 600; }

@media (max-width: 768px) {
  .sidebar { display: none; }
  .bottom-nav { display: flex; }
  .main { padding-bottom: 56px; }
}
</style>
