<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import LoginView from "./views/LoginView.vue";
import DashboardView from "./views/DashboardView.vue";
import AccountsView from "./views/AccountsView.vue";
import TransactionsView from "./views/TransactionsView.vue";
import IngestView from "./views/IngestView.vue";
import ReviewView from "./views/ReviewView.vue";
import ImportView from "./views/ImportView.vue";
import InsightsView from "./views/InsightsView.vue";
import BudgetsView from "./views/BudgetsView.vue";
import GoalsView from "./views/GoalsView.vue";
import MembersView from "./views/MembersView.vue";
import InviteAcceptView from "./views/InviteAcceptView.vue";
import ChatView from "./views/ChatView.vue";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher.vue";
import { useAuthStore } from "./stores/auth";
import { useWorkspaceStore } from "./stores/workspace";

const auth = useAuthStore();
const wsStore = useWorkspaceStore();

type Tab = "dashboard" | "accounts" | "transactions" | "ingest" | "review" | "import" | "insights" | "budgets" | "goals" | "members" | "chat";
const tab = ref<Tab>("dashboard");

const inviteToken = computed(() => new URLSearchParams(window.location.search).get("token"));

onMounted(() => {
  if (auth.isAuthenticated) wsStore.load();
});

function onInviteAcceptDone() {
  history.replaceState(null, "", window.location.pathname);
  wsStore.load();
}
</script>

<template>
  <InviteAcceptView v-if="auth.isAuthenticated && inviteToken" @done="onInviteAcceptDone" />
  <LoginView v-else-if="!auth.isAuthenticated" />

  <div v-else class="app-shell">
    <nav class="app-nav">
      <span class="app-logo">Finanças</span>
      <div class="nav-tabs">
        <button :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">Dashboard</button>
        <button :class="{ active: tab === 'accounts' }" @click="tab = 'accounts'">Contas</button>
        <button :class="{ active: tab === 'transactions' }" @click="tab = 'transactions'">Transações</button>
        <button :class="{ active: tab === 'ingest' }" @click="tab = 'ingest'">Lançar por IA</button>
        <button :class="{ active: tab === 'review' }" @click="tab = 'review'">Revisar</button>
        <button :class="{ active: tab === 'import' }" @click="tab = 'import'">Importar</button>
        <button :class="{ active: tab === 'insights' }" @click="tab = 'insights'">Insights</button>
        <button :class="{ active: tab === 'budgets' }" @click="tab = 'budgets'">Orçamentos</button>
        <button :class="{ active: tab === 'goals' }" @click="tab = 'goals'">Metas</button>
        <button :class="{ active: tab === 'members' }" @click="tab = 'members'">Membros</button>
        <button :class="{ active: tab === 'chat' }" @click="tab = 'chat'">Chat IA</button>
      </div>
      <WorkspaceSwitcher />
      <button class="btn-signout" @click="auth.signOut()">Sair</button>
    </nav>

    <main class="app-main">
      <DashboardView v-if="tab === 'dashboard'" />
      <AccountsView v-else-if="tab === 'accounts'" />
      <TransactionsView v-else-if="tab === 'transactions'" />
      <IngestView v-else-if="tab === 'ingest'" />
      <ReviewView v-else-if="tab === 'review'" />
      <ImportView v-else-if="tab === 'import'" />
      <InsightsView v-else-if="tab === 'insights'" />
      <BudgetsView v-else-if="tab === 'budgets'" />
      <GoalsView v-else-if="tab === 'goals'" />
      <MembersView v-else-if="tab === 'members'" />
      <ChatView v-else-if="tab === 'chat'" />
    </main>
  </div>
</template>

<style scoped>
.app-shell { display: flex; flex-direction: column; min-height: 100vh; }
.app-nav {
  display: flex;
  align-items: center;
  gap: calc(var(--space) * 2);
  padding: calc(var(--space) * 2) calc(var(--space) * 3);
  background: var(--color-surface);
  border-bottom: 1px solid #222;
  position: sticky;
  top: 0;
  z-index: 10;
}
.app-logo { font-weight: 700; font-size: 1.1rem; margin-right: auto; }
.nav-tabs { display: flex; gap: var(--space); }
.nav-tabs button {
  padding: calc(var(--space)) calc(var(--space) * 2);
  border: none;
  border-radius: calc(var(--radius) / 2);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.95rem;
  opacity: 0.6;
  transition: opacity .15s, background .15s;
}
.nav-tabs button.active, .nav-tabs button:hover { opacity: 1; background: rgba(79,124,255,.15); }
.nav-tabs button.active { color: var(--color-primary); }
.btn-signout {
  padding: calc(var(--space)) calc(var(--space) * 2);
  border: 1px solid #333;
  border-radius: calc(var(--radius) / 2);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.85rem;
}
.app-main { flex: 1; }
</style>
