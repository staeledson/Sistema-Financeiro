import "./load-env";
import IORedis from "ioredis";
import { S3Client } from "@aws-sdk/client-s3";
import { registerHealthWorker } from "./health.processor";
import { registerIngestWorker } from "./ai/ingest.processor";
import { registerRemindersWorker, scheduleRemindersJob } from "./reminders/reminders.processor";
import { OpenRouterGateway } from "./ai/openrouter";
import { GroqSttGateway } from "./ai/stt-groq";
import { s3ClientConfig } from "./s3-config";

// A URL já traz usuário/senha/TLS (rediss:); family 0 aceita IPv4 e IPv6 (rede privada da Railway).
const connection = new IORedis(process.env["REDIS_URL"] ?? "redis://127.0.0.1:6380", {
  maxRetriesPerRequest: null,
  family: 0,
});

const s3 = new S3Client(s3ClientConfig(process.env));

const ai = new OpenRouterGateway(
  process.env["OPENROUTER_API_KEY"] ?? "",
  process.env["OPENROUTER_VISION_MODEL"] ?? "google/gemini-2.0-flash-001",
  process.env["OPENROUTER_TEXT_MODEL"] ?? "openai/gpt-4o-mini",
);
const stt = new GroqSttGateway(process.env["GROQ_API_KEY"] ?? "");

const workers = [
  registerHealthWorker(connection),
  registerIngestWorker(connection, {
    ai,
    stt,
    s3,
    s3Bucket: process.env["MINIO_BUCKET"] ?? "financas",
  }),
  registerRemindersWorker(connection),
];

scheduleRemindersJob(connection);

console.log("Worker started");

async function shutdown() {
  await Promise.all(workers.map((worker) => worker.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
