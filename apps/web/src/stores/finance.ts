import { defineStore } from "pinia";
import { ref } from "vue";
import { api, type BankAccount, type Category, type Transaction, type Balances, type NewAccount, type UpdateAccount } from "../lib/api";

export const useFinanceStore = defineStore("finance", () => {
  const accounts = ref<BankAccount[]>([]);
  const categories = ref<Category[]>([]);
  const transactions = ref<Transaction[]>([]);
  const balances = ref<Balances | null>(null);

  async function loadAccounts() {
    accounts.value = await api.accounts.list();
  }

  async function createAccount(data: NewAccount) {
    const acc = await api.accounts.create(data);
    accounts.value.push(acc);
    return acc;
  }

  async function updateAccount(id: string, data: UpdateAccount) {
    const acc = await api.accounts.update(id, data);
    accounts.value = accounts.value.map((a) => (a.id === id ? acc : a));
    return acc;
  }

  /** Ajusta o saldo inicial para o saldo real e recarrega contas e saldos. */
  async function reconcileAccount(id: string, balanceCents: number) {
    const result = await api.accounts.reconcile(id, balanceCents);
    await Promise.all([loadAccounts(), loadBalances()]);
    return result;
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
    // Não entra em `transactions`: a resposta é parcial; quem lança recarrega a lista com os filtros atuais.
    return api.transactions.create(data);
  }

  async function loadBalances() {
    balances.value = await api.balances.get();
  }

  return {
    accounts, categories, transactions, balances,
    loadAccounts, createAccount, updateAccount, reconcileAccount, archiveAccount,
    loadCategories, loadTransactions, createTransaction,
    loadBalances,
  };
});
