import { useAuthStore } from "../stores/auth";
import { useWorkspaceStore } from "../stores/workspace";

export const API_BASE: string = import.meta.env.VITE_API_URL || "/api";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Cabeçalhos de autenticação e workspace, para uploads e chamadas fora do `http`. */
export function authHeaders(): Record<string, string> {
  const auth = useAuthStore();
  const ws = useWorkspaceStore();
  const h: Record<string, string> = { authorization: `Bearer ${auth.token ?? ""}` };
  if (ws.activeId) h["x-workspace-id"] = ws.activeId;
  return h;
}

function messageFrom(text: string): string {
  if (!text) return "Erro na requisição";
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.join("; ");
  } catch {
    /* corpo não é JSON */
  }
  return text;
}

export async function http<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers = authHeaders();
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (res.status === 401) useAuthStore().expire();
  if (!res.ok) throw new HttpError(res.status, messageFrom(text), text);
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
