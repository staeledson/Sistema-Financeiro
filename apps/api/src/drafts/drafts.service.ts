import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";
import { TransactionsService } from "../transactions/transactions.service";

@Injectable()
export class DraftsService {
  constructor(private readonly txService: TransactionsService) {}

  async list(workspaceId: string) {
    return prisma.transactionDraft.findMany({
      where: { workspaceId, status: "draft" },
      select: {
        id: true, kind: true, type: true, amountCents: true, date: true,
        description: true, counterparty: true, suggestedCategory: true,
        categoryId: true, confidence: true, sourceRef: true, createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async confirm(
    workspaceId: string,
    userId: string,
    draftId: string,
    overrides: {
      accountId?: string | null;
      sourceAccountId?: string | null;
      destAccountId?: string | null;
      categoryId?: string | null;
      amountCents?: number;
      date?: string;
      description?: string | null;
    },
  ) {
    const draft = await prisma.transactionDraft.findFirst({
      where: { id: draftId, workspaceId, status: "draft" },
    });
    if (!draft) throw new NotFoundException("rascunho não encontrado");
    if (!draft.type) throw new BadRequestException("rascunho sem tipo definido");
    if (!draft.amountCents) throw new BadRequestException("rascunho sem valor definido");
    if (!draft.date) throw new BadRequestException("rascunho sem data definida");

    const input = {
      type: draft.type,
      amountCents: overrides.amountCents ?? Number(draft.amountCents),
      date: overrides.date ?? draft.date.toISOString().slice(0, 10),
      accountId: overrides.accountId ?? null,
      sourceAccountId: overrides.sourceAccountId ?? null,
      destAccountId: overrides.destAccountId ?? null,
      categoryId: overrides.categoryId ?? draft.categoryId ?? null,
      description: overrides.description ?? draft.description ?? null,
      counterparty: draft.counterparty ?? null,
    };

    if (draft.type !== "transfer" && !input.accountId) {
      throw new BadRequestException("escolha uma conta para confirmar");
    }

    const created = await this.txService.create(workspaceId, userId, input);
    await prisma.transactionDraft.update({
      where: { id: draftId },
      data: { status: "discarded" },
    });
    return created;
  }

  async discard(workspaceId: string, draftId: string) {
    const draft = await prisma.transactionDraft.findFirst({
      where: { id: draftId, workspaceId },
    });
    if (!draft) throw new NotFoundException();
    await prisma.transactionDraft.update({
      where: { id: draftId },
      data: { status: "discarded" },
    });
    return { ok: true };
  }
}
