import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type BankAccount, type Category, type Transaction, type Balances, type Dashboard } from "../lib/api";

export const useFinanceStore = defineStore("finance", () => {
  const accounts = ref<BankAccount[]>([]);
  const categories = ref<Category[]>([]);
  const transactions = ref<Transaction[]>([]);
  const balances = ref<Balances | null>(null);
  const dashboard = ref<Dashboard | null>(null);

  async function loadAccounts() {
    accounts.value = await api.accounts.list();
  }

  async function createAccount(data: { type: BankAccount["type"]; name: string; openingBalanceCents?: number }) {
    const acc = await api.accounts.create(data);
    accounts.value.push(acc);
    return acc;
  }

  async function archiveAccount(id: string) {
    await api.accounts.archive(id);
    accounts.value = accounts.value.filter((a) => a.id !== id);
    if (balances.value) {
      balances.value.accounts = balances.value.accounts.filter((b) => b.accountId !== id);
    }
  }

  async function loadCategories() {
    categories.value = await api.categories.list();
  }

  async function loadTransactions(params?: Parameters<typeof api.transactions.list>[0]) {
    transactions.value = await api.transactions.list(params);
  }

  async function createTransaction(data: Parameters<typeof api.transactions.create>[0]) {
    const tx = await api.transactions.create(data);
    transactions.value.unshift(tx);
    return tx;
  }

  async function loadBalances() {
    balances.value = await api.balances.get();
  }

  async function loadDashboard(month: string) {
    dashboard.value = await api.dashboard.get(month);
  }

  return {
    accounts, categories, transactions, balances, dashboard,
    loadAccounts, createAccount, archiveAccount,
    loadCategories, loadTransactions, createTransaction,
    loadBalances, loadDashboard,
  };
});
