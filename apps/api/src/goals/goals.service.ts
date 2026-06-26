import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class GoalsService {
  async list(workspaceId: string) {
    return prisma.goal.findMany({
      where: { workspaceId },
      select: {
        id: true, name: true, targetCents: true, savedCents: true, deadline: true, createdAt: true,
        contributions: {
          select: { id: true, amountCents: true, date: true, createdById: true },
          orderBy: { date: "desc" },
          take: 5,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(workspaceId: string, body: { name: string; targetCents: number; deadline?: string | null }) {
    return prisma.goal.create({
      data: {
        workspaceId,
        name: body.name,
        targetCents: BigInt(body.targetCents),
        deadline: body.deadline ? new Date(body.deadline) : null,
      },
      select: { id: true, name: true, targetCents: true, savedCents: true, deadline: true },
    });
  }

  async delete(workspaceId: string, id: string) {
    const goal = await prisma.goal.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!goal) throw new NotFoundException("meta não encontrada");
    await prisma.goal.delete({ where: { id } });
    return { id };
  }

  async contribute(workspaceId: string, goalId: string, userId: string, body: { amountCents: number; date?: string }) {
    const goal = await prisma.goal.findFirst({ where: { id: goalId, workspaceId }, select: { id: true, savedCents: true } });
    if (!goal) throw new NotFoundException("meta não encontrada");

    const amount = BigInt(body.amountCents);
    const date = body.date ? new Date(body.date) : new Date();

    const [contribution] = await prisma.$transaction([
      prisma.goalContribution.create({
        data: { goalId, amountCents: amount, date, createdById: userId },
        select: { id: true, amountCents: true, date: true },
      }),
      prisma.goal.update({
        where: { id: goalId },
        data: { savedCents: { increment: amount } },
      }),
    ]);

    return contribution;
  }
}
