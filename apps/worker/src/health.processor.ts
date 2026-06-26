import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { HEALTH_NOOP, SYSTEM_QUEUE } from "./queue";

export function registerHealthWorker(connection: Redis) {
  return new Worker(
    SYSTEM_QUEUE,
    async (job) => {
      if (job.name === HEALTH_NOOP) return { ok: true };
      return { ok: false };
    },
    { connection },
  );
}
