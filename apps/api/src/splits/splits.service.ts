import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class SplitsService {
  async setSplits(workspaceId: string, transactionId: string, splits: { userId: string; shareCents: number }[]) {
    const userIds = [...new Set(splits.map((s) => s.userId))];
    if (userIds.length !== splits.length) throw new BadRequestException("usuário repetido nas cotas");
    const members = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: userIds } } });
    if (members !== userIds.length) throw new BadRequestException("todas as cotas devem ser de membros do workspace");

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

    const net = new Map<string, { payerId: string; debtorId: string; cents: number }>();
    for (const r of rows) {
      const key = [r.payerId, r.debtorId].sort().join("|");
      const cur = net.get(key) ?? { payerId: r.payerId, debtorId: r.debtorId, cents: 0 };
      cur.cents += r.payerId === cur.payerId ? Number(r.netCents) : -Number(r.netCents);
      net.set(key, cur);
    }
    const settled = [...net.values()]
      .filter((n) => n.cents !== 0)
      .map((n) => (n.cents > 0 ? n : { payerId: n.debtorId, debtorId: n.payerId, cents: -n.cents }));

    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(settled.flatMap((r) => [r.payerId, r.debtorId]))] } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return settled.map((r) => ({ payer: userMap.get(r.payerId), debtor: userMap.get(r.debtorId), owedCents: r.cents }));
  }
}
