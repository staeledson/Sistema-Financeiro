import { createApp } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import App from "./App.vue";
import ptBR from "./i18n/pt-BR";
import { router } from "./router";
import { mountWhenReady } from "./lib/boot";
import { useThemeStore } from "./stores/theme";
import "./styles/tokens.css";

const i18n = createI18n({ locale: "pt-BR", messages: { "pt-BR": ptBR } });
const pinia = createPinia();

const app = createApp(App).use(pinia).use(i18n).use(router);
// Aplica o tema salvo antes do primeiro render para evitar flash de tema errado.
useThemeStore(pinia);
// Monta só depois da navegação inicial: o App decide convite/compartilhamento pela rota.
void mountWhenReady(() => router.isReady(), () => app.mount("#app"));
