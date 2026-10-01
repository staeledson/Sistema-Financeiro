import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { categoryFits, normalizeDescriptionKey, type AccountEntity } from "@app/shared";
import { prisma } from "../database";
import { findSimilarUncategorizedIds } from "../common/similar-transactions";
import { CategoryRulesService } from "../category-rules/category-rules.service";
import { TransactionsService } from "../transactions/transactions.service";

const CANDIDATE_WINDOW_DAYS = 7;
const NO_DESCRIPTION_KEY = "(sem descrição)";

const textOf = (t: { counterparty: string | null; description: string | null }) =>
  [t.counterparty, t.description].filter(Boolean).join(" ");

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class ReviewService {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly rules: CategoryRulesService,
  ) {}

  async pending(workspaceId: string, filters: { entity?: AccountEntity; accountId?: string }) {
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        reviewStatus: "pending",
        ignored: false,
        transferPairId: null,
        type: { in: ["income", "expense"] },
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.entity ? { account: { entity: filters.entity } } : {}),
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      select: {
        id: true, type: true, amountCents: true, counterparty: true, description: true,
        suggestedCategoryId: true, account: { select: { entity: true } },
      },
    });

    type Group = {
      key: string; type: "income" | "expense"; description: string; count: number; totalCents: number;
      entities: Set<string>; suggestions: Map<string, number>; transactionIds: string[];
    };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const text = textOf(r);
      // Chave vazia (só dígitos/pontuação) cai num grupo próprio; o texto exibido continua sendo o cru da primeira linha.
      const normalized = normalizeDescriptionKey(text) || NO_DESCRIPTION_KEY;
      const key = `${r.type}|${normalized}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key, type: r.type as "income" | "expense", description: text || NO_DESCRIPTION_KEY, count: 0, totalCents: 0,
          entities: new Set(), suggestions: new Map(), transactionIds: [],
        };
        groups.set(key, g);
      }
      g.count++;
      g.totalCents += Number(r.amountCents);
      g.entities.add(r.account?.entity ?? "none");
      if (r.suggestedCategoryId) g.suggestions.set(r.suggestedCategoryId, (g.suggestions.get(r.suggestedCategoryId) ?? 0) + 1);
      g.transactionIds.push(r.id);
    }

    const out = [...groups.values()].map((g) => {
      const only = g.entities.size === 1 ? [...g.entities][0] : null;
      const suggested = [...g.suggestions].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        key: g.key, type: g.type, description: g.description, count: g.count, totalCents: g.totalCents,
        entity: only === "pf" || only === "pj" ? only : null,
        suggestedCategoryId: suggested, transactionIds: g.transactionIds,
      };
    });
    out.sort((a, b) => b.totalCents - a.totalCents);
    return { total: rows.length, groups: out };
  }

  private async loadTransactions(workspaceId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const txs = await prisma.transaction.findMany({
      where: { id: { in: unique }, workspaceId },
      select: { id: true, type: true, amountCents: true, date: true, accountId: true, counterparty: true, description: true, transferPairId: true, account: { select: { entity: true } } },
    });
    if (txs.length !== unique.length) throw new NotFoundException("lançamento não encontrado");
    return txs;
  }

  async categorize(
    workspaceId: string,
    dto: { transactionIds: string[]; categoryId: string; createRule: boolean; applyToSimilar: boolean },
  ) {
    const category = await prisma.category.findFirst({
      where: { id: dto.categoryId, workspaceId },
      select: { id: true, type: true, entity: true },
    });
    if (!category) throw new NotFoundException("categoria não encontrada");
    const txs = await this.loadTransactions(workspaceId, dto.transactionIds);
    for (const t of txs) {
      if (!categoryFits(category, t, (t.account?.entity ?? null) as AccountEntity | null)) {
        throw new BadRequestException("a categoria não serve a um dos lançamentos (tipo ou entidade)");
      }
    }

    const ids = new Set(txs.map((t) => t.id));
    let similarUpdated = 0;
    if (dto.applyToSimilar) {
      const similar = await findSimilarUncategorizedIds(workspaceId, txs, category);
      similar.forEach((id) => ids.add(id));
      similarUpdated = similar.length;
    }

    await prisma.transaction.updateMany({
      where: { id: { in: [...ids] }, workspaceId },
      data: { categoryId: category.id, categorySource: "manual", categoryConfidence: null, reviewStatus: "ok", suggestedCategoryId: null },
    });

    let ruleCreated = false;
    if (dto.createRule) {
      await this.rules.learnFromCorrection({ counterparty: txs[0].counterparty, description: txs[0].description }, category.id, workspaceId);
      ruleCreated = true;
    }
    return { updated: ids.size, similarUpdated, ruleCreated };
  }

  async acceptSuggestion(workspaceId: string, transactionIds: string[]) {
    const txs = await prisma.transaction.findMany({
      where: { id: { in: [...new Set(transactionIds)] }, workspaceId },
      select: { id: true, type: true, suggestedCategoryId: true, account: { select: { entity: true } } },
    });
    const withSuggestion = txs.filter((t) => t.suggestedCategoryId);
    const categories = await prisma.category.findMany({
      where: { workspaceId, id: { in: [...new Set(withSuggestion.map((t) => t.suggestedCategoryId!))] } },
      select: { id: true, type: true, entity: true },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    let accepted = 0;
    for (const t of withSuggestion) {
      const c = byId.get(t.suggestedCategoryId!);
      if (!c || !categoryFits(c, t, (t.account?.entity ?? null) as AccountEntity | null)) continue;
      await prisma.transaction.update({
        where: { id: t.id },
        data: { categoryId: c.id, categorySource: "ai", reviewStatus: "ok", suggestedCategoryId: null },
      });
      accepted++;
    }
    return { accepted, skipped: new Set(transactionIds).size - accepted };
  }

  async markTransfer(workspaceId: string, transactionId: string, counterpartTransactionId: string) {
    if (transactionId === counterpartTransactionId) throw new BadRequestException("os lançamentos precisam ser diferentes");
    const [a, b] = await this.loadTransactions(workspaceId, [transactionId, counterpartTransactionId]);
    const ok =
      a.accountId && b.accountId && a.accountId !== b.accountId &&
      a.type !== "transfer" && b.type !== "transfer" && a.type !== b.type &&
      Number(a.amountCents) === Number(b.amountCents) &&
      !a.transferPairId && !b.transferPairId;
    if (!ok) {
      throw new BadRequestException("não formam um par: contas diferentes, sentidos opostos, mesmo valor e sem par anterior");
    }
    const transferPairId = randomUUID();
    await prisma.transaction.updateMany({
      where: { id: { in: [a.id, b.id] }, workspaceId },
      data: { transferPairId, reviewStatus: "ok" },
    });
    return { transferPairId };
  }

  async unpair(workspaceId: string, transferPairId: string) {
    const { count } = await prisma.transaction.updateMany({
      where: { workspaceId, transferPairId },
      data: { transferPairId: null, reviewStatus: "pending", categorySource: "none" },
    });
    if (count === 0) throw new NotFoundException("par não encontrado");
    return { unpaired: count };
  }

  async ignore(workspaceId: string, transactionIds: string[]) {
    const { count } = await prisma.transaction.updateMany({
      where: { id: { in: [...new Set(transactionIds)] }, workspaceId },
      data: { ignored: true, reviewStatus: "ok" },
    });
    return { ignored: count };
  }

  recategorize(workspaceId: string, userId: string) {
    return this.transactions.enqueueCategorizationJob(workspaceId, userId);
  }

  async transferCandidates(workspaceId: string, transactionId: string) {
    const tx = await prisma.transaction.findFirst({
      where: { id: transactionId, workspaceId },
      select: { id: true, type: true, amountCents: true, date: true, accountId: true },
    });
    if (!tx || tx.type === "transfer") throw new NotFoundException("lançamento não encontrado");
    const from = new Date(tx.date.getTime() - CANDIDATE_WINDOW_DAYS * 86_400_000);
    const to = new Date(tx.date.getTime() + CANDIDATE_WINDOW_DAYS * 86_400_000);
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        type: tx.type === "expense" ? "income" : "expense",
        amountCents: tx.amountCents,
        date: { gte: from, lte: to },
        accountId: { not: tx.accountId, notIn: [] },
        transferPairId: null,
        ignored: false,
      },
      orderBy: { date: "asc" },
      select: { id: true, date: true, amountCents: true, description: true, account: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id, date: iso(r.date), amountCents: Number(r.amountCents), description: r.description, accountName: r.account?.name ?? null,
    }));
  }
}
