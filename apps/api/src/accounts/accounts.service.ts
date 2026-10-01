import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { cardFieldsPresent, type AccountEntity, type AccountInput, type AccountUpdateInput } from "@app/shared";
import { prisma } from "../database";
import { BalancesService } from "../balances/balances.service";

const ACCOUNT_SELECT = {
  id: true,
  type: true,
  name: true,
  openingBalanceCents: true,
  archived: true,
  entity: true,
  institution: true,
  externalId: true,
  closingDay: true,
  dueDay: true,
  creditLimitCents: true,
} as const;

@Injectable()
export class AccountsService {
  constructor(private readonly balances: BalancesService) {}

  async create(workspaceId: string, dto: AccountInput) {
    return prisma.bankAccount.create({
      data: {
        workspaceId,
        type: dto.type,
        name: dto.name,
        openingBalanceCents: dto.openingBalanceCents ?? 0,
        entity: dto.entity,
        institution: dto.institution,
        externalId: dto.externalId ?? null,
        closingDay: dto.closingDay ?? null,
        dueDay: dto.dueDay ?? null,
        creditLimitCents: dto.creditLimitCents ?? null,
      },
      select: ACCOUNT_SELECT,
    });
  }

  async listActive(workspaceId: string, entity?: AccountEntity) {
    return prisma.bankAccount.findMany({
      where: { workspaceId, archived: false, ...(entity ? { entity } : {}) },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: "asc" },
    });
  }

  async update(workspaceId: string, id: string, dto: AccountUpdateInput) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId }, select: { type: true } });
    if (!existing) throw new NotFoundException();
    if (existing.type !== "credit_card" && cardFieldsPresent(dto)) {
      throw new BadRequestException("closingDay, dueDay e creditLimitCents só valem para cartão de crédito");
    }
    return prisma.bankAccount.update({ where: { id }, data: dto, select: ACCOUNT_SELECT });
  }

  async archive(workspaceId: string, id: string) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException();
    await prisma.bankAccount.update({ where: { id }, data: { archived: true } });
    return { ok: true };
  }

  /**
   * Faz o saldo da conta bater com o saldo real informado, ajustando `openingBalanceCents` pela diferença.
   * Leitura, cálculo e escrita ficam numa transação com a linha da conta travada (FOR UPDATE): um lançamento
   * concorrente (importação) referencia a conta por chave estrangeira e espera o commit, então o saldo lido é o final.
   */
  async reconcile(workspaceId: string, id: string, targetCents: number) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM bank_accounts WHERE "id" = ${id} AND "workspaceId" = ${workspaceId} AND "archived" = false FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException("conta não encontrada");

      const [row] = await this.balances.accountBalances(workspaceId, { accountId: id }, undefined, tx);
      if (!row) throw new NotFoundException("conta não encontrada");
      if (!Number.isSafeInteger(row.balanceCents)) throw new BadRequestException("saldo atual fora da faixa suportada");
      const { openingBalanceCents } = await tx.bankAccount.findUniqueOrThrow({ where: { id }, select: { openingBalanceCents: true } });

      const adjustment = BigInt(targetCents) - BigInt(row.balanceCents);
      const newOpening = openingBalanceCents + adjustment;
      if (newOpening > BigInt(Number.MAX_SAFE_INTEGER) || newOpening < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new BadRequestException("o ajuste leva o saldo inicial além do limite suportado");
      }
      if (adjustment !== 0n) await tx.bankAccount.update({ where: { id }, data: { openingBalanceCents: newOpening } });

      return {
        accountId: id,
        previousBalanceCents: row.balanceCents,
        newBalanceCents: targetCents,
        adjustmentCents: Number(adjustment),
        openingBalanceCents: Number(newOpening),
      };
    });
  }
}
