import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Queue } from "bullmq";
import { categoryFits, parseInstallment, transactionInputSchema, type AccountEntity, type TransactionInput } from "@app/shared";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database";
import { findSimilarUncategorizedIds } from "../common/similar-transactions";
import { CategoryRulesService } from "../category-rules/category-rules.service";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "../ingest/ingest.types";

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>,
    @Optional() private readonly rules?: CategoryRulesService,
  ) {}

  async updateCategory(workspaceId: string, id: string, categoryId: string | null, applyToSimilar = false) {
    const tx = await prisma.transaction.findFirst({
      where: { id, workspaceId },
      select: { id: true, type: true, counterparty: true, description: true, account: { select: { entity: true } } },
    });
    if (!tx) throw new NotFoundException("transação não encontrada");

    if (categoryId === null) {
      await prisma.transaction.update({
        where: { id },
        data: { categoryId: null, categorySource: "none", categoryConfidence: null, suggestedCategoryId: null, reviewStatus: "pending" },
      });
      return { id, categoryId: null, similarCount: 0 };
    }

    const category = await prisma.category.findFirst({
      where: { id: categoryId, workspaceId },
      select: { id: true, type: true, entity: true },
    });
    if (!category) throw new BadRequestException("categoria inexistente");
    if (!categoryFits(category, tx, (tx.account?.entity ?? null) as AccountEntity | null)) {
      throw new BadRequestException("a categoria não serve ao lançamento (tipo ou entidade)");
    }

    const similar = applyToSimilar ? await findSimilarUncategorizedIds(workspaceId, [tx], category) : [];
    await prisma.transaction.updateMany({
      where: { id: { in: [id, ...similar] }, workspaceId },
      data: { categoryId, categorySource: "manual", categoryConfidence: null, reviewStatus: "ok", suggestedCategoryId: null },
    });

    if (this.rules) {
      await this.rules.learnFromCorrection({ counterparty: tx.counterparty, description: tx.description }, categoryId, workspaceId);
    }
    return { id, categoryId, similarCount: similar.length };
  }

  async enqueueCategorizationJob(workspaceId: string, userId: string, batchId?: string) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind: "categorize", createdById: userId, inputRef: batchId ?? null },
      select: { id: true },
    });
    await this.queue.add("ingest", {
      jobId: job.id,
      workspaceId,
      userId,
      kind: "categorize",
      ...(batchId ? { batchId } : {}),
    });
    return job;
  }

  async create(workspaceId: string, userId: string, body: unknown) {
    const dto: TransactionInput = transactionInputSchema.parse(body);

    const accountIds = [dto.accountId, dto.sourceAccountId, dto.destAccountId].filter(Boolean) as string[];
    let accountType: string | null = null;
    if (accountIds.length) {
      const accs = await prisma.bankAccount.findMany({ where: { id: { in: accountIds }, workspaceId }, select: { id: true, type: true } });
      if (accs.length !== accountIds.length) throw new BadRequestException("conta inexistente no workspace");
      accountType = accs.find((a) => a.id === dto.accountId)?.type ?? null;
    }
    // parcela "n/m" só faz sentido em despesa lançada no cartão de crédito
    const inst = dto.type === "expense" && accountType === "credit_card" ? (parseInstallment(dto.description) ?? parseInstallment(dto.counterparty)) : null;

    if (dto.categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: dto.categoryId, workspaceId }, select: { type: true } });
      if (!cat) throw new BadRequestException("categoria inexistente");
      if (cat.type !== dto.type) throw new BadRequestException("categoria não casa com o tipo da transação");
    }

    return prisma.transaction.create({
      data: {
        workspaceId,
        type: dto.type,
        amountCents: dto.amountCents,
        date: new Date(dto.date),
        accountId: dto.accountId ?? null,
        sourceAccountId: dto.sourceAccountId ?? null,
        destAccountId: dto.destAccountId ?? null,
        categoryId: dto.categoryId ?? null,
        description: dto.description ?? null,
        counterparty: dto.counterparty ?? null,
        source: "manual",
        categorySource: dto.categoryId ? "manual" : "none",
        installmentCurrent: inst?.current ?? null,
        installmentTotal: inst?.total ?? null,
        createdById: userId,
      },
      select: {
        id: true, type: true, amountCents: true, date: true,
        accountId: true, sourceAccountId: true, destAccountId: true,
        categoryId: true, description: true, counterparty: true, source: true,
        installmentCurrent: true, installmentTotal: true,
      },
    });
  }

  async list(
    workspaceId: string,
    filters: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string; entity?: AccountEntity },
  ) {
    const { from, to, accountId, categoryId, q, entity } = filters;

    const and: Prisma.TransactionWhereInput[] = [];
    if (accountId) {
      and.push({ OR: [{ accountId }, { sourceAccountId: accountId }, { destAccountId: accountId }] });
    }
    if (entity) {
      and.push({ OR: [{ account: { entity } }, { sourceAccount: { entity } }, { destAccount: { entity } }] });
    }

    return prisma.transaction.findMany({
      where: {
        workspaceId,
        ...(from || to
          ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}),
        ...(and.length ? { AND: and } : {}),
      },
      select: {
        id: true, type: true, amountCents: true, date: true,
        accountId: true, sourceAccountId: true, destAccountId: true,
        categoryId: true, description: true, counterparty: true, source: true, createdAt: true,
        transferPairId: true, ignored: true, categorySource: true, reviewStatus: true,
        installmentCurrent: true, installmentTotal: true,
      },
      orderBy: { date: "desc" },
    });
  }
}
