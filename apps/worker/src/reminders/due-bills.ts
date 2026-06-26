export interface BillLike {
  id: string;
  name: string;
  amountCents: bigint | number;
  dueDate: Date;
  workspaceId: string;
}

export function dueBills(bills: BillLike[], today: Date, windowDays = 3): BillLike[] {
  const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const limitMs = todayMs + windowDays * 86_400_000;
  return bills.filter((b) => {
    const dueMs = Date.UTC(b.dueDate.getFullYear(), b.dueDate.getMonth(), b.dueDate.getDate());
    return dueMs >= todayMs && dueMs <= limitMs;
  });
}
