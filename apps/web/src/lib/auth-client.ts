import { createAuthClient } from "better-auth/vue";
import { bearerClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3000",
  plugins: [bearerClient()],
});
