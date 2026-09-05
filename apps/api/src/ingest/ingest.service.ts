import { Inject, Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { randomUUID } from "crypto";
import { prisma } from "../database";
import { StorageService } from "../storage/storage.service";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "./ingest.types";

@Injectable()
export class IngestService {
  constructor(
    private readonly storage: StorageService,
    @Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>,
  ) {}

  async enqueueText(workspaceId: string, userId: string, text: string) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind: "parse_text", inputRef: text.slice(0, 500), createdById: userId },
      select: { id: true },
    });
    await this.queue.add("ingest", { jobId: job.id, workspaceId, userId, kind: "parse_text", text });
    return { jobId: job.id };
  }

  async getUploadUrl(workspaceId: string, ext: string, contentType: string) {
    const key = `${workspaceId}/${randomUUID()}.${ext}`;
    const url = await this.storage.presignedUploadUrl(key, contentType);
    return { url, storagePath: key };
  }

  async enqueueFile(
    workspaceId: string,
    userId: string,
    kind: "parse_image" | "parse_audio",
    storagePath: string,
  ) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind, inputRef: storagePath, createdById: userId },
      select: { id: true },
    });
    await this.queue.add("ingest", { jobId: job.id, workspaceId, userId, kind, storagePath });
    return { jobId: job.id };
  }

  async getJob(workspaceId: string, jobId: string) {
    return prisma.aiJob.findFirst({
      where: { id: jobId, workspaceId },
      select: { id: true, status: true, kind: true, createdAt: true, error: true },
    });
  }
}
