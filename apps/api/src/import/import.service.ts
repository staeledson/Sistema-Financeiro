import { Injectable, NotFoundException } from "@nestjs/common";
import Papa from "papaparse";
import { Queue } from "bullmq";
import { csvMappingSchema, csvRowToTransaction, parseOfx, importFingerprint } from "@app/shared";
import { prisma } from "../database";
import { StorageService } from "../storage/storage.service";
import type { IngestJobData } from "../ingest/ingest.types";

const AI_QUEUE = "ai";

@Injectable()
export class ImportService {
  private readonly queue: Queue<IngestJobData>;

  constructor(private readonly storage: StorageService) {
    this.queue = new Queue<IngestJobData>(AI_QUEUE, {
      connection: {
        host: new URL(process.env["REDIS_URL"] ?? "redis://localhost:6379").hostname,
        port: Number(new URL(process.env["REDIS_URL"] ?? "redis://localhost:6379").port) || 6379,
      },
    });
  }

  async csvPreview(
    workspaceId: string,
    userId: string,
    accountId: string,
    mappingRaw: unknown,
    csv: string,
  ) {
    const mapping = csvMappingSchema.parse(mappingRaw);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const txs = parsed.data.map((r) => csvRowToTransaction(r, mapping, accountId));

    const fps = txs.map((t) => t.fingerprint);
    const existing = await prisma.transaction.findMany({
      where: { workspaceId, importFingerprint: { in: fps } },
      select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));

    const rows = txs.map((t) => ({ ...t, dup: seen.has(t.fingerprint) }));
    const dupCount = rows.filter((r) => r.dup).length;

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId,
        format: "csv",
        status: "preview",
        rowCount: rows.length,
        dupCount,
        createdById: userId,
      },
      select: { id: true },
    });

    return { batchId: batch.id, rows, rowCount: rows.length, dupCount };
  }

  async ofxPreview(workspaceId: string, userId: string, accountId: string, ofxText: string) {
    const ofxTxns = parseOfx(ofxText);
    const rows = ofxTxns.map((t) => {
      const isExpense = t.amountCents < 0;
      const abs = Math.abs(t.amountCents);
      const fp = `ofx:${accountId}:${t.fitid}`;
      return {
        type: isExpense ? ("expense" as const) : ("income" as const),
        amountCents: abs,
        date: t.dateISO,
        accountId,
        description: t.memo,
        fingerprint: fp,
      };
    });

    const fps = rows.map((r) => r.fingerprint);
    const existing = await prisma.transaction.findMany({
      where: { workspaceId, importFingerprint: { in: fps } },
      select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));

    const flagged = rows.map((r) => ({ ...r, dup: seen.has(r.fingerprint) }));
    const dupCount = flagged.filter((r) => r.dup).length;

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId,
        format: "ofx",
        status: "preview",
        rowCount: flagged.length,
        dupCount,
        createdById: userId,
      },
      select: { id: true },
    });

    return { batchId: batch.id, rows: flagged, rowCount: flagged.length, dupCount };
  }

  async commit(
    workspaceId: string,
    userId: string,
    batchId: string,
    rows: Array<{
      type: "income" | "expense";
      amountCents: number;
      date: string;
      accountId: string;
      description: string | null;
      categoryId?: string | null;
      fingerprint: string;
    }>,
  ) {
    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, workspaceId },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException("lote não encontrado");

    const payload = rows.map((r) => ({
      workspaceId,
      type: r.type,
      amountCents: BigInt(r.amountCents),
      date: new Date(r.date),
      accountId: r.accountId,
      categoryId: r.categoryId ?? null,
      description: r.description,
      source: "import",
      importFingerprint: r.fingerprint,
      importBatchId: batchId,
      createdById: userId,
    }));

    await prisma.transaction.createMany({ data: payload, skipDuplicates: true });

    const inserted = await prisma.transaction.count({
      where: { importBatchId: batchId },
    });

    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: "committed" },
    });

    return { inserted };
  }

  async enqueuePdf(workspaceId: string, userId: string, storagePath: string) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind: "parse_invoice", inputRef: storagePath, createdById: userId },
      select: { id: true },
    });

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        format: "pdf",
        status: "preview",
        fileRef: storagePath,
        createdById: userId,
      },
      select: { id: true },
    });

    await this.queue.add("ingest", {
      jobId: job.id,
      workspaceId,
      userId,
      kind: "parse_invoice",
      storagePath,
    } as IngestJobData);

    return { jobId: job.id, batchId: batch.id };
  }

  async listMappings(workspaceId: string) {
    return prisma.importMapping.findMany({
      where: { workspaceId },
      select: { id: true, name: true, format: true, mapping: true },
      orderBy: { name: "asc" },
    });
  }

  async saveMapping(
    workspaceId: string,
    name: string,
    format: "csv" | "ofx" | "pdf",
    mapping: unknown,
  ) {
    return prisma.importMapping.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name, format, mapping: mapping as object },
      update: { mapping: mapping as object, format },
      select: { id: true, name: true },
    });
  }
}
