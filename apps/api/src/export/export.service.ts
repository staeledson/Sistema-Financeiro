import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { prisma } from "../database";

@Injectable()
export class ExportService {
  async transactionsCsv(workspaceId: string): Promise<string> {
    const txs = await prisma.transaction.findMany({
      where: { workspaceId },
      orderBy: { date: "desc" },
      select: { id: true, type: true, amountCents: true, date: true, description: true, categoryId: true, source: true },
    });
    const header = "id,type,amountCents,date,description,categoryId,source\n";
    const rows = txs
      .map((t) =>
        [t.id, t.type, t.amountCents.toString(), t.date.toISOString().slice(0, 10), `"${(t.description ?? "").replace(/"/g, '""')}"`, t.categoryId ?? "", t.source].join(","),
      )
      .join("\n");
    return header + rows;
  }

  async transactionsXlsx(workspaceId: string): Promise<Buffer> {
    const txs = await prisma.transaction.findMany({
      where: { workspaceId },
      orderBy: { date: "desc" },
      select: { id: true, type: true, amountCents: true, date: true, description: true, categoryId: true, source: true },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Transações");
    ws.columns = [
      { header: "ID", key: "id", width: 28 },
      { header: "Tipo", key: "type", width: 10 },
      { header: "Valor (centavos)", key: "amountCents", width: 18 },
      { header: "Data", key: "date", width: 12 },
      { header: "Descrição", key: "description", width: 40 },
      { header: "Categoria", key: "categoryId", width: 28 },
      { header: "Origem", key: "source", width: 12 },
    ];
    for (const t of txs) {
      ws.addRow({ ...t, amountCents: Number(t.amountCents), date: t.date.toISOString().slice(0, 10) });
    }
    return (await wb.xlsx.writeBuffer()) as Buffer;
  }

  async backupJson(workspaceId: string): Promise<object> {
    const [workspace, accounts, categories, transactions, budgets, goals] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, type: true, name: true, currency: true } }),
      prisma.bankAccount.findMany({ where: { workspaceId } }),
      prisma.category.findMany({ where: { workspaceId } }),
      prisma.transaction.findMany({ where: { workspaceId }, orderBy: { date: "desc" } }),
      prisma.budget.findMany({ where: { workspaceId } }),
      prisma.goal.findMany({ where: { workspaceId } }),
    ]);

    const serialize = (arr: unknown[]) =>
      arr.map((item) => {
        const obj = item as Record<string, unknown>;
        return Object.fromEntries(
          Object.entries(obj).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
        );
      });

    return {
      workspace,
      exportedAt: new Date().toISOString(),
      accounts: serialize(accounts),
      categories: serialize(categories),
      transactions: serialize(transactions),
      budgets: serialize(budgets),
      goals: serialize(goals),
    };
  }
}
