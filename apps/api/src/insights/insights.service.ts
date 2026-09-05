import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue } from "bullmq";
import { prisma } from "../database";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "../ingest/ingest.types";

@Injectable()
export class InsightsService {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>) {}

  async list(workspaceId: string, read?: string) {
    return prisma.insight.findMany({
      where: {
        workspaceId,
        ...(read !== undefined ? { read: read === "true" } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, dedupKey: true, period: true, payload: true, read: true, createdAt: true },
    });
  }

  async markRead(workspaceId: string, id: string) {
    const insight = await prisma.insight.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!insight) throw new NotFoundException("insight não encontrado");
    return prisma.insight.update({ where: { id }, data: { read: true }, select: { id: true, read: true } });
  }

  async enqueueCompute(workspaceId: string, userId: string) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind: "compute_insights", createdById: userId },
      select: { id: true },
    });
    await this.queue.add("ingest", {
      jobId: job.id,
      workspaceId,
      userId,
      kind: "compute_insights",
    } as IngestJobData);
    return { jobId: job.id };
  }
}
