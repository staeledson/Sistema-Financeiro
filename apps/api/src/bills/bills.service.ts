import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class BillsService {
  list(workspaceId: string) {
    return prisma.scheduledBill.findMany({
      where: { workspaceId, active: true },
      orderBy: { dueDate: "asc" },
      select: { id: true, name: true, amountCents: true, dueDate: true, recurrence: true, categoryId: true, createdAt: true },
    });
  }

  async create(
    workspaceId: string,
    userId: string,
    body: { name: string; amountCents: number; dueDate: string; recurrence: "once" | "weekly" | "monthly" | "yearly"; categoryId?: string | null },
  ) {
    if (body.categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: body.categoryId, workspaceId }, select: { id: true } });
      if (!cat) throw new BadRequestException("categoria inexistente no workspace");
    }
    return prisma.scheduledBill.create({
      data: {
        workspaceId,
        createdById: userId,
        name: body.name,
        amountCents: BigInt(body.amountCents),
        dueDate: new Date(body.dueDate),
        recurrence: body.recurrence,
        categoryId: body.categoryId ?? null,
      },
      select: { id: true, name: true, amountCents: true, dueDate: true, recurrence: true, active: true },
    });
  }

  async remove(workspaceId: string, id: string) {
    const bill = await prisma.scheduledBill.findFirst({ where: { id, workspaceId } });
    if (!bill) throw new NotFoundException();
    await prisma.scheduledBill.update({ where: { id }, data: { active: false } });
    return { ok: true };
  }
}
