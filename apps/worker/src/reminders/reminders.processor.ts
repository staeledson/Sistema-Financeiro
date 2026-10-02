import { Worker, Queue } from "bullmq";
import type { Redis } from "ioredis";
import { todayInTimeZone } from "@app/shared";
import { prisma } from "../database";
import { dueBills } from "./due-bills";
import { sendPush, SubInfo } from "../push/push.gateway";

export const REMINDERS_QUEUE = "reminders";
export const REMINDERS_JOB = "daily_reminders";

export function registerRemindersWorker(connection: Redis, sendPushFn = sendPush) {
  const worker = new Worker(
    REMINDERS_QUEUE,
    async () => {
      const todayISO = todayInTimeZone(process.env["APP_TIMEZONE"]);
      const today = new Date(`${todayISO}T00:00:00Z`);

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
        const subs = await prisma.pushSubscription.findMany({ where: { workspaceId } });
        for (const bill of bills) {
          const fmt = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
          const period = todayISO;
          const dedupKey = `bill:${bill.id}`;
          await prisma.insight.upsert({
            where: { workspaceId_type_dedupKey_period: { workspaceId, type: "bill_due", dedupKey, period } },
            update: {},
            create: {
              workspaceId,
              type: "bill_due",
              dedupKey,
              period,
              payload: { billId: bill.id, name: bill.name, amountCents: Number(bill.amountCents), dueDate: bill.dueDate.toISOString().slice(0, 10) },
            },
          });

          for (const sub of subs) {
            try {
              await sendPushFn(sub as SubInfo, {
                title: "Conta a vencer",
                body: `${bill.name} — ${fmt(Number(bill.amountCents))} vence em breve`,
                url: "/",
              });
            } catch (err) {
              // 404/410: o navegador cancelou a inscrição; apagar evita tentar para sempre
              const code = (err as { statusCode?: number }).statusCode;
              if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            }
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
