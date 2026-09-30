import "./load-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { registerAuthHandler } from "./auth/auth-handler";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 20 * 1024 * 1024 }),
  );
  registerAuthHandler(app.getHttpAdapter().getInstance());
  const port = Number(process.env["PORT"] ?? 3100);
  await app.listen(port, "0.0.0.0");
  console.log(`API ouvindo em http://localhost:${port}`);
}
bootstrap();
