import type { RedisOptions } from "bullmq";

/**
 * Converte REDIS_URL em opções de conexão do ioredis/BullMQ, preservando usuário, senha, banco e TLS
 * (`rediss:`). Redis gerenciado (Railway) exige senha; `family: 0` aceita IPv4 e IPv6 (rede privada).
 */
export function redisConnectionFromUrl(raw: string | undefined): RedisOptions {
  const url = new URL(raw?.trim() || "redis://localhost:6380");
  const options: RedisOptions = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    family: 0,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  const db = Number(url.pathname.replace(/^\//, ""));
  if (Number.isInteger(db) && db > 0) options.db = db;
  if (url.protocol === "rediss:") options.tls = {};
  return options;
}
