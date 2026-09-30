import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodError } from "@app/shared";

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const message = error.issues.map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`);
    void reply.status(400).send({ statusCode: 400, error: "Bad Request", message });
  }
}
