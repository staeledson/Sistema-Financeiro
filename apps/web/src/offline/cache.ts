import { openDB, IDBPDatabase } from "idb";

const DB_NAME = "financas-cache";
const DB_VERSION = 1;
const STORE = "reads";

let _db: IDBPDatabase | null = null;

async function db() {
  if (!_db) {
    _db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    });
  }
  return _db;
}

export async function put(key: string, value: unknown): Promise<void> {
  (await db()).put(STORE, value, key);
}

export async function get<T>(key: string): Promise<T | undefined> {
  return (await db()).get(STORE, key) as Promise<T | undefined>;
}
