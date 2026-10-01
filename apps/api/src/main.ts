import "./load-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { registerAuthHandler } from "./auth/auth-handler";
import { baseUrlWarning } from "./auth/origins";
import { describeSignupMode, signupMode } from "./auth/signup-policy";

async function bootstrap() {
  console.log(`Cadastro: ${describeSignupMode(signupMode(process.env["SIGNUP_ALLOWED_EMAILS"]))}`);
  const aviso = baseUrlWarning(process.env["BETTER_AUTH_URL"], process.env["NODE_ENV"]);
  if (aviso) console.warn(`AVISO: ${aviso}`);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 20 * 1024 * 1024,
      // Atrás do proxy da Railway/Vercel: IP e protocolo reais vêm de X-Forwarded-*.
      trustProxy: process.env["TRUST_PROXY"] === "true",
    }),
  );
  app.enableShutdownHooks();
  registerAuthHandler(app.getHttpAdapter().getInstance());
  const port = Number(process.env["PORT"] ?? 3100);
  await app.listen(port, "0.0.0.0");
  console.log(`API ouvindo em http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error("Falha ao iniciar a API", err);
  process.exit(1);
});
