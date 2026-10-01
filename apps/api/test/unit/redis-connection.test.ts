import { describe, it, expect } from "vitest";
import { redisConnectionFromUrl } from "../../src/queue/redis-connection";

describe("redisConnectionFromUrl", () => {
  it("sem autenticação: host, porta e family 0, sem credenciais nem TLS", () => {
    const opts = redisConnectionFromUrl("redis://localhost:6380");
    expect(opts).toEqual({ host: "localhost", port: 6380, family: 0 });
  });

  it("usa a porta 6379 e o host padrão quando ausentes", () => {
    expect(redisConnectionFromUrl("redis://redis.interno")).toMatchObject({ host: "redis.interno", port: 6379 });
    expect(redisConnectionFromUrl(undefined)).toMatchObject({ host: "localhost", port: 6380 });
    expect(redisConnectionFromUrl("  ")).toMatchObject({ host: "localhost", port: 6380 });
  });

  it("preserva usuário e senha", () => {
    const opts = redisConnectionFromUrl("redis://default:segredo@redis.railway.internal:6379");
    expect(opts).toMatchObject({
      host: "redis.railway.internal",
      port: 6379,
      username: "default",
      password: "segredo",
      family: 0,
    });
    expect(opts.tls).toBeUndefined();
  });

  it("decodifica caracteres especiais da senha", () => {
    const opts = redisConnectionFromUrl("redis://default:p%40ss%3A%2Fw%23rd%25@h.exemplo:6379");
    expect(opts.password).toBe("p@ss:/w#rd%");
  });

  it("aceita só senha (sem usuário)", () => {
    const opts = redisConnectionFromUrl("redis://:so-senha@h.exemplo:6379");
    expect(opts.password).toBe("so-senha");
    expect(opts.username).toBeUndefined();
  });

  it("rediss: ativa TLS", () => {
    expect(redisConnectionFromUrl("rediss://default:x@h.exemplo:6380").tls).toEqual({});
  });

  it("lê o número do banco do caminho", () => {
    expect(redisConnectionFromUrl("redis://h.exemplo:6379/2").db).toBe(2);
    expect(redisConnectionFromUrl("redis://h.exemplo:6379/").db).toBeUndefined();
  });
});
