import { Worker, Queue } from "bullmq";
import type { Redis } from "ioredis";
import { prisma } from "../database";
import { dueBills } from "./due-bills";
import { sendPush, SubInfo } from "../push/push.gateway";

export const REMINDERS_QUEUE = "reminders";
export const REMINDERS_JOB = "daily_reminders";

export function registerRemindersWorker(connection: Redis, sendPushFn = sendPush) {
  const worker = new Worker(
    REMINDERS_QUEUE,
    async () => {
      const today = new Date();

      const allBills = await prisma.scheduledBill.findMany({
        where: { active: true },
        select: { id: true, name: true, amountCents: true, dueDate: true, workspaceId: true },
      });

      const due = dueBills(allBills, today, 3);
      if (!due.length) return;

      // Group by workspace
      const byWs = new Map<string, typeof due>();
      for (const b of due) {
        if (!byWs.has(b.workspaceId)) byWs.set(b.workspaceId, []);
        byWs.get(b.workspaceId)!.push(b);
      }

      for (const [workspaceId, bills] of byWs) {
        // Create insight per bill
        for (const bill of bills) {
          const fmt = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
          await prisma.insight.upsert({
            where: { workspaceId_type_period: { workspaceId, type: "budget_alert", period: `bill:${bill.id}:${today.toISOString().slice(0, 10)}` } },
            update: {},
            create: {
              workspaceId,
              type: "budget_alert",
              period: `bill:${bill.id}:${today.toISOString().slice(0, 10)}`,
              payload: { billId: bill.id, name: bill.name, amountCents: Number(bill.amountCents), dueDate: bill.dueDate.toISOString().slice(0, 10) },
            },
          });

          // Push notifications
          const subs = await prisma.pushSubscription.findMany({ where: { workspaceId } });
          for (const sub of subs) {
            await sendPushFn(sub as SubInfo, {
              title: "Conta a vencer",
              body: `${bill.name} — ${fmt(Number(bill.amountCents))} vence em breve`,
              url: "/",
            }).catch(() => {});
          }
        }
      }
    },
    { connection },
  );

  return worker;
}

export function scheduleRemindersJob(connection: Redis) {
  const queue = new Queue(REMINDERS_QUEUE, { connection });
  queue.add(REMINDERS_JOB, {}, { repeat: { pattern: "0 8 * * *" }, jobId: "daily_reminders" });
  return queue;
}
