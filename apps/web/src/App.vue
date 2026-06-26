<script setup lang="ts">
import LoginView from "./views/LoginView.vue";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();
</script>

<template>
  <LoginView v-if="!auth.isAuthenticated" />
  <div v-else class="workspace-home">
    <p>Bem-vindo!</p>
    <button @click="auth.signOut()">Sair</button>
  </div>
</template>
