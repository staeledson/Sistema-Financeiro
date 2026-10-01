import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { prisma } from "../database";

/** Sem guard de autenticação: usado pelo healthcheck da hospedagem. Não expõe detalhes de erro. */
@Controller("health")
export class HealthController {
  @Get()
  async check() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: true };
    } catch {
      throw new HttpException({ ok: false, db: false }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
