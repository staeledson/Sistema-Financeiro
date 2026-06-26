import { describe, it, expect, afterAll } from "vitest";
import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { registerHealthWorker } from "../src/health.processor";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

afterAll(async () => {
  await connection.quit();
});

describe("fila system", () => {
  it("processa health.noop até completar", async () => {
    const worker = registerHealthWorker(connection);
    const queue = new Queue("system", { connection });
    const events = new QueueEvents("system", { connection });
    await events.waitUntilReady();

    const job = await queue.add("health.noop", {});
    const result = await job.waitUntilFinished(events);
    expect(result).toEqual({ ok: true });

    await worker.close();
    await queue.close();
    await events.close();
  });
});
