export interface BillLike {
  id: string;
  name: string;
  amountCents: bigint | number;
  dueDate: Date;
  workspaceId: string;
}

export function dueBills(bills: BillLike[], today: Date, windowDays = 3): BillLike[] {
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const limitMs = todayMs + windowDays * 86_400_000;
  return bills.filter((b) => {
    const dueMs = Date.UTC(b.dueDate.getUTCFullYear(), b.dueDate.getUTCMonth(), b.dueDate.getUTCDate());
    return dueMs >= todayMs && dueMs <= limitMs;
  });
}
