import { describe, it, expect, vi, beforeEach } from "vitest";

const captured = vi.hoisted(() => ({ processor: null as null | (() => Promise<void>) }));
vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_queue: string, processor: () => Promise<void>) {
      captured.processor = processor;
    }
  },
  Queue: class {
    add = vi.fn();
  },
}));

const db = vi.hoisted(() => ({
  findBills: vi.fn(),
  upsert: vi.fn(),
  findSubs: vi.fn(),
}));
vi.mock("../src/database", () => ({
  prisma: {
    scheduledBill: { findMany: db.findBills },
    insight: { upsert: db.upsert },
    pushSubscription: { findMany: db.findSubs },
  },
}));

import { registerRemindersWorker } from "../src/reminders/reminders.processor";

describe("lembretes diários", () => {
  beforeEach(() => {
    db.findBills.mockReset();
    db.upsert.mockReset();
    db.findSubs.mockReset();
  });

  it("grava o insight por upsert com chave (workspace, tipo, dedupKey, período): rodar duas vezes não duplica", async () => {
    const today = new Date();
    db.findBills.mockResolvedValue([
      { id: "b1", name: "Luz", amountCents: 10000n, dueDate: today, workspaceId: "ws1" },
    ]);
    db.findSubs.mockResolvedValue([{ id: "s1", endpoint: "e", p256dh: "p", auth: "a" }]);
    const push = vi.fn().mockResolvedValue(undefined);

    registerRemindersWorker({} as never, push);
    await captured.processor!();
    await captured.processor!();

    const period = today.toISOString().slice(0, 10);
    expect(db.upsert).toHaveBeenCalledTimes(2);
    for (const [args] of db.upsert.mock.calls) {
      expect(args.where).toEqual({
        workspaceId_type_dedupKey_period: { workspaceId: "ws1", type: "budget_alert", dedupKey: "bill:b1", period },
      });
      expect(args.update).toEqual({});
    }
    expect(push).toHaveBeenCalledTimes(2); // uma notificação por execução e por inscrição
  });

  it("sem contas a vencer não grava nada", async () => {
    db.findBills.mockResolvedValue([]);
    registerRemindersWorker({} as never, vi.fn());
    await captured.processor!();
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
