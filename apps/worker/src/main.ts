import "./load-env";
import IORedis from "ioredis";
import { S3Client } from "@aws-sdk/client-s3";
import { registerHealthWorker } from "./health.processor";
import { registerIngestWorker } from "./ai/ingest.processor";
import { registerRemindersWorker, scheduleRemindersJob } from "./reminders/reminders.processor";
import { OpenRouterGateway } from "./ai/openrouter";
import { GroqSttGateway } from "./ai/stt-groq";

const connection = new IORedis(process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

const s3 = new S3Client({
  endpoint: process.env["MINIO_ENDPOINT"] ?? "http://localhost:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env["MINIO_ACCESS_KEY"] ?? "minio",
    secretAccessKey: process.env["MINIO_SECRET_KEY"] ?? "minio123",
  },
  forcePathStyle: true,
});

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
