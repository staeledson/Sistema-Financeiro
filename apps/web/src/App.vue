<script setup lang="ts">
import { ref } from "vue";
import LoginView from "./views/LoginView.vue";
import DashboardView from "./views/DashboardView.vue";
import AccountsView from "./views/AccountsView.vue";
import TransactionsView from "./views/TransactionsView.vue";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();
const tab = ref<"dashboard" | "accounts" | "transactions">("dashboard");
</script>

<template>
  <LoginView v-if="!auth.isAuthenticated" />

  <div v-else class="app-shell">
    <nav class="app-nav">
      <span class="app-logo">Finanças</span>
      <div class="nav-tabs">
        <button :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">Dashboard</button>
        <button :class="{ active: tab === 'accounts' }" @click="tab = 'accounts'">Contas</button>
        <button :class="{ active: tab === 'transactions' }" @click="tab = 'transactions'">Transações</button>
      </div>
      <button class="btn-signout" @click="auth.signOut()">Sair</button>
    </nav>

    <main class="app-main">
      <DashboardView v-if="tab === 'dashboard'" />
      <AccountsView v-else-if="tab === 'accounts'" />
      <TransactionsView v-else-if="tab === 'transactions'" />
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
