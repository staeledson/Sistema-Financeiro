import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import type { Queue } from "bullmq";
import { prisma } from "../database";
import { AI_QUEUE } from "../queue/queue.tokens";

/** Tempo máximo do PING no Redis: o health nunca fica pendurado por causa dele. */
export const REDIS_PING_TIMEOUT_MS = 1000;

/**
 * Sem guard de autenticação: usado pelo healthcheck da hospedagem. Não expõe detalhes de erro.
 * Só o banco decide entre 200 e 503; `redis` é informativo (Redis fora do ar não derruba a API).
 */
@Controller("health")
export class HealthController {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue) {}

  private async pingRedis(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      // O cliente real é um ioredis (tem PING); o tipo da BullMQ só expõe um subconjunto.
      const ping = (async () => {
        const client = (await this.queue.client) as unknown as { ping(): Promise<string> };
        return (await client.ping()) === "PONG";
      })();
      const timeout = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), REDIS_PING_TIMEOUT_MS);
      });
      return await Promise.race([ping, timeout]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingDb(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  @Get()
  async check() {
    const [db, redis] = await Promise.all([this.pingDb(), this.pingRedis()]);
    if (!db) throw new HttpException({ ok: false, db: false, redis }, HttpStatus.SERVICE_UNAVAILABLE);
    return { ok: true, db: true, redis };
  }
}
