import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { transactionInputSchema, type TransactionInput } from "@app/shared";
import { prisma } from "../database";
import { CategoryRulesService } from "../category-rules/category-rules.service";

@Injectable()
export class TransactionsService {
  constructor(@Optional() private readonly rules?: CategoryRulesService) {}

  async updateCategory(workspaceId: string, id: string, categoryId: string | null) {
    const tx = await prisma.transaction.findFirst({
      where: { id, workspaceId },
      select: { id: true, counterparty: true, description: true },
    });
    if (!tx) throw new NotFoundException("transação não encontrada");

    await prisma.transaction.update({ where: { id }, data: { categoryId } });

    if (categoryId && this.rules) {
      await this.rules.learnFromCorrection(
        { counterparty: tx.counterparty, description: tx.description },
        categoryId,
        workspaceId,
      );
    }
    return { id, categoryId };
  }

  async enqueueCategorizationJob(workspaceId: string, userId: string) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind: "categorize", createdById: userId },
      select: { id: true },
    });
    return job;
  }

  async create(workspaceId: string, userId: string, body: unknown) {
    const dto: TransactionInput = transactionInputSchema.parse(body);

    const accountIds = [dto.accountId, dto.sourceAccountId, dto.destAccountId].filter(Boolean) as string[];
    if (accountIds.length) {
      const accs = await prisma.bankAccount.findMany({ where: { id: { in: accountIds }, workspaceId }, select: { id: true } });
      if (accs.length !== accountIds.length) throw new BadRequestException("conta inexistente no workspace");
    }

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
        createdById: userId,
      },
      select: {
        id: true, type: true, amountCents: true, date: true,
        accountId: true, sourceAccountId: true, destAccountId: true,
        categoryId: true, description: true, counterparty: true, source: true,
      },
    });
  }

  async list(workspaceId: string, filters: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string }) {
    const { from, to, accountId, categoryId, q } = filters;

    return prisma.transaction.findMany({
      where: {
        workspaceId,
        ...(from || to
          ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(accountId ? {
          OR: [
            { accountId },
            { sourceAccountId: accountId },
            { destAccountId: accountId },
          ],
        } : {}),
        ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}),
      },
      select: {
        id: true, type: true, amountCents: true, date: true,
        accountId: true, sourceAccountId: true, destAccountId: true,
        categoryId: true, description: true, counterparty: true, source: true, createdAt: true,
      },
      orderBy: { date: "desc" },
    });
  }
}
