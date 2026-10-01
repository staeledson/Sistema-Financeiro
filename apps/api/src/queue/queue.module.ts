import { Global, Module, type OnApplicationShutdown, Inject } from "@nestjs/common";
import { Queue } from "bullmq";
import type { IngestJobData } from "../ingest/ingest.types";
import { AI_QUEUE, AI_QUEUE_NAME } from "./queue.tokens";
import { redisConnectionFromUrl } from "./redis-connection";

@Global()
@Module({
  providers: [
    {
      provide: AI_QUEUE,
      useFactory: () =>
        new Queue<IngestJobData>(AI_QUEUE_NAME, {
          connection: redisConnectionFromUrl(process.env["REDIS_URL"]),
          prefix: process.env["BULLMQ_PREFIX"] ?? "bull",
        }),
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
