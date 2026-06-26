import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../database";
import type { OpenRouterGateway } from "../ai/openrouter";
import { mapCategory } from "../ai/category-map";

export interface PdfInvoiceJobData {
  jobId: string;
  workspaceId: string;
  userId: string;
  storagePath: string;
}

export async function processPdfInvoice(
  data: PdfInvoiceJobData,
  deps: { ai: OpenRouterGateway; s3: S3Client; s3Bucket: string },
) {
  const { jobId, workspaceId, userId, storagePath } = data;

  const bytes = await downloadFromS3(deps.s3, deps.s3Bucket, storagePath);

  // Dynamic import because pdf-parse is CJS and may have issues with static ESM
  const pdfParse = await import("pdf-parse").then((m) => m.default ?? m);
  const pdfData = await pdfParse(Buffer.from(bytes));
  const text = pdfData.text;

  const { lines, costTokens } = await deps.ai.parseInvoiceText(text);

  const cats = await prisma.category.findMany({
    where: { workspaceId },
    select: { id: true, name: true, type: true },
  });

  await Promise.all(
    lines.map((line) => {
      const categoryId = mapCategory(line.suggestedCategory ?? null, line.type, cats);
      return prisma.transactionDraft.create({
        data: {
          workspaceId,
          aiJobId: jobId,
          kind: "parse_invoice",
          type: line.type,
          amountCents: BigInt(line.amountCents),
          date: new Date(line.date),
          description: line.description ?? null,
          suggestedCategory: line.suggestedCategory ?? null,
          categoryId,
          confidence: line.confidence,
          sourceRef: storagePath,
          createdById: userId,
        },
      });
    }),
  );

  await prisma.aiJob.update({
    where: { id: jobId },
    data: { status: "done", result: { count: lines.length }, costTokens },
  });
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
