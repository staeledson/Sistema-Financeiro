import { Global, Module, type OnApplicationShutdown, Inject } from "@nestjs/common";
import { Queue } from "bullmq";
import type { IngestJobData } from "../ingest/ingest.types";
import { AI_QUEUE, AI_QUEUE_NAME } from "./queue.tokens";

function redisConnection() {
  const url = new URL(process.env["REDIS_URL"] ?? "redis://localhost:6380");
  return { host: url.hostname, port: Number(url.port) || 6379 };
}

@Global()
@Module({
  providers: [
    {
      provide: AI_QUEUE,
      useFactory: () => new Queue<IngestJobData>(AI_QUEUE_NAME, { connection: redisConnection() }),
    },
  ],
  exports: [AI_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>) {}
  async onApplicationShutdown() {
    await this.queue.close();
  }
}
