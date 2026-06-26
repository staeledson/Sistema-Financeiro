import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class SplitsService {
  async setSplits(workspaceId: string, transactionId: string, splits: { userId: string; shareCents: number }[]) {
    const tx = await prisma.transaction.findFirst({ where: { id: transactionId, workspaceId }, select: { id: true, amountCents: true } });
    if (!tx) throw new NotFoundException("transação não encontrada");

    const total = splits.reduce((s, sp) => s + sp.shareCents, 0);
    if (total !== Number(tx.amountCents)) {
      throw new BadRequestException(`soma das cotas (${total}) deve igualar o valor da transação (${tx.amountCents})`);
    }

    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({ where: { transactionId } }),
      prisma.transactionSplit.createMany({
        data: splits.map((sp) => ({ transactionId, userId: sp.userId, shareCents: BigInt(sp.shareCents) })),
      }),
    ]);

    return { transactionId, splits };
  }

  async memberBalances(workspaceId: string) {
    type BalRow = { payerId: string; debtorId: string; netCents: bigint };

    const rows = await prisma.$queryRaw<BalRow[]>`
      SELECT
        t."createdById" AS "payerId",
        s."userId" AS "debtorId",
        SUM(s."shareCents") AS "netCents"
      FROM transaction_splits s
      JOIN transactions t ON t.id = s."transactionId"
      WHERE t."workspaceId" = ${workspaceId}
        AND s."userId" != t."createdById"
      GROUP BY t."createdById", s."userId"
    `;

    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => [r.payerId, r.debtorId]))] } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => ({
      payer: userMap.get(r.payerId),
      debtor: userMap.get(r.debtorId),
      owedCents: Number(r.netCents),
    }));
  }
}
