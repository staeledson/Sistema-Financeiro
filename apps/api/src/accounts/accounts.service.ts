import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
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

/** Timeout da transação (P2028) ou espera de trava estourada no Postgres (55P03, `lock_timeout`). */
function isLockOrTimeoutError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null;
  if (!err) return false;
  if (err.code === "P2028") return true;
  const text = `${err.message ?? ""} ${err.meta?.message ?? ""}`;
  return err.meta?.code === "55P03" || /55P03|lock timeout|lock_not_available/i.test(text);
}

@Injectable()
export class AccountsService {
  /** Quanto a conciliação espera pela trava da conta (uma importação em curso); abaixo do timeout da transação. */
  lockTimeoutMs = 10_000;

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
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId }, select: { type: true, entity: true } });
    if (!existing) throw new NotFoundException();
    if (existing.type !== "credit_card" && cardFieldsPresent(dto)) {
      throw new BadRequestException("closingDay, dueDay e creditLimitCents só valem para cartão de crédito");
    }
    if (dto.entity && dto.entity !== existing.entity) {
      // categorias exclusivas da entidade atual deixariam de servir aos lançamentos desta conta
      const conflicting = await prisma.transaction.count({ where: { workspaceId, accountId: id, category: { entity: existing.entity } } });
      if (conflicting > 0) {
        throw new ConflictException(`${conflicting} lançamento(s) desta conta usam categorias ${existing.entity.toUpperCase()}; recategorize-os antes de trocar a entidade`);
      }
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
    try {
      return await this.reconcileInTransaction(workspaceId, id, targetCents);
    } catch (e) {
      if (!(e instanceof HttpException) && isLockOrTimeoutError(e)) {
        throw new ConflictException("Outra operação está em andamento nesta conta; tente novamente.");
      }
      throw e;
    }
  }

  private reconcileInTransaction(workspaceId: string, id: string, targetCents: number) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', ${String(this.lockTimeoutMs)}, true)`;
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM bank_accounts WHERE "id" = ${id} AND "workspaceId" = ${workspaceId} AND "archived" = false FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException("conta não encontrada");

      const [row] = await this.balances.accountBalances(workspaceId, { accountId: id }, undefined, tx);
      if (!row) throw new NotFoundException("conta não encontrada");
      if (!Number.isSafeInteger(row.balanceCents)) throw new UnprocessableEntityException("saldo atual da conta fora da faixa suportada");
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
    }, { timeout: 15_000 }); // a confirmação de importação aceita até 30 s; a conciliação espera a trava e depois é rápida
  }
}
