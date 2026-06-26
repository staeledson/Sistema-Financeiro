import { createApp } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import App from "./App.vue";
import ptBR from "./i18n/pt-BR";
import "./styles/tokens.css";

const i18n = createI18n({ locale: "pt-BR", messages: { "pt-BR": ptBR } });

createApp(App).use(createPinia()).use(i18n).mount("#app");
