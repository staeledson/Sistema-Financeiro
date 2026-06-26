import { openDB } from "idb";

const DB_NAME = "financas-write-queue";
const DB_VERSION = 1;
const STORE = "queue";

interface QueueItem {
  clientId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  createdAt: number;
}

async function db() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientId" });
      }
    },
  });
}

export async function enqueue(item: Omit<QueueItem, "createdAt">): Promise<void> {
  const store = await db();
  await store.put(STORE, { ...item, createdAt: Date.now() });
}

export async function flush(fetchFn: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const store = await db();
  const all = (await store.getAll(STORE)) as QueueItem[];
  all.sort((a, b) => a.createdAt - b.createdAt);

  let sent = 0;
  let failed = 0;
  for (const item of all) {
    try {
      const res = await fetchFn(item.url, { method: item.method, headers: item.headers, body: item.body });
      if (res.ok) {
        await store.delete(STORE, item.clientId);
        sent++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

export async function size(): Promise<number> {
  return (await db()).count(STORE);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flush().catch(() => {}));
}
