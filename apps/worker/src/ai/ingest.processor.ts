import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../database";
import { OpenRouterGateway } from "./openrouter";
import { GroqSttGateway } from "./stt-groq";
import { mapCategory } from "./category-map";
import { AI_QUEUE } from "../queue";
import { processPdfInvoice } from "../import/pdf.processor";

export interface IngestJobData {
  jobId: string;
  workspaceId: string;
  userId: string;
  kind: "parse_text" | "parse_image" | "parse_audio" | "parse_invoice";
  text?: string;
  storagePath?: string;
}

export function registerIngestWorker(
  connection: Redis,
  deps: {
    ai: OpenRouterGateway;
    stt: GroqSttGateway;
    s3: S3Client;
    s3Bucket: string;
  },
) {
  return new Worker<IngestJobData>(
    AI_QUEUE,
    async (job) => {
      const { jobId, workspaceId, userId, kind, text, storagePath } = job.data;

      await prisma.aiJob.update({ where: { id: jobId }, data: { status: "processing" } });

      try {
        // PDF invoice → multiple drafts; handled separately
        if (kind === "parse_invoice") {
          await processPdfInvoice(
            { jobId, workspaceId, userId, storagePath: storagePath! },
            { ai: deps.ai, s3: deps.s3, s3Bucket: deps.s3Bucket },
          );
          return { ok: true };
        }

        let result: { draft: Awaited<ReturnType<OpenRouterGateway["parseText"]>>["draft"]; costTokens: number | null };

        if (kind === "parse_text") {
          result = await deps.ai.parseText(text!);
        } else if (kind === "parse_image") {
          const bytes = await downloadFromS3(deps.s3, deps.s3Bucket, storagePath!);
          const dataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
          result = await deps.ai.parseImage(dataUrl);
        } else {
          // parse_audio
          const bytes = await downloadFromS3(deps.s3, deps.s3Bucket, storagePath!);
          const blob = new Blob([bytes], { type: "audio/webm" });
          const transcript = await deps.stt.transcribe(blob);
          result = await deps.ai.parseText(transcript);
        }

        const cats = await prisma.category.findMany({
          where: { workspaceId },
          select: { id: true, name: true, type: true },
        });
        const categoryId = mapCategory(result.draft.suggestedCategory, result.draft.type, cats);

        await prisma.transactionDraft.create({
          data: {
            workspaceId,
            aiJobId: jobId,
            kind,
            type: result.draft.type,
            amountCents: BigInt(result.draft.amountCents),
            date: new Date(result.draft.date),
            description: result.draft.description ?? null,
            counterparty: result.draft.counterparty ?? null,
            suggestedCategory: result.draft.suggestedCategory ?? null,
            categoryId,
            confidence: result.draft.confidence,
            sourceRef: storagePath ?? text ?? null,
            createdById: userId,
          },
        });

        await prisma.aiJob.update({
          where: { id: jobId },
          data: { status: "done", result: result.draft, costTokens: result.costTokens },
        });

        return { ok: true };
      } catch (e) {
        await prisma.aiJob.update({
          where: { id: jobId },
          data: { status: "failed", error: String(e) },
        });
        throw e;
      }
    },
    { connection },
  );
}

async function downloadFromS3(s3: S3Client, bucket: string, key: string): Promise<Uint8Array> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const res = await s3.send(cmd);
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
