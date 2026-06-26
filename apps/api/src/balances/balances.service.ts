import { Injectable } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class BalancesService {
  async getForWorkspace(workspaceId: string) {
    const accounts = await prisma.bankAccount.findMany({
      where: { workspaceId, archived: false },
      select: { id: true, name: true, type: true, openingBalanceCents: true },
    });

    const txs = await prisma.transaction.findMany({
      where: { workspaceId },
      select: { type: true, amountCents: true, accountId: true, sourceAccountId: true, destAccountId: true },
    });

    const balances = accounts.map((acc) => {
      let balance = Number(acc.openingBalanceCents);
      for (const tx of txs) {
        if (tx.type === "income" && tx.accountId === acc.id) balance += Number(tx.amountCents);
        else if (tx.type === "expense" && tx.accountId === acc.id) balance -= Number(tx.amountCents);
        else if (tx.type === "transfer" && tx.destAccountId === acc.id) balance += Number(tx.amountCents);
        else if (tx.type === "transfer" && tx.sourceAccountId === acc.id) balance -= Number(tx.amountCents);
      }
      return { accountId: acc.id, name: acc.name, type: acc.type, balanceCents: balance };
    });

    const consolidatedCents = balances.reduce((s, b) => s + b.balanceCents, 0);
    return { accounts: balances, consolidatedCents };
  }
}
