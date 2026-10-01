import { describe, it, expect } from "vitest";
import { isSignupAllowed, parseTrustedOrigins } from "../../src/auth/signup-policy";

describe("isSignupAllowed", () => {
  const lista = "a@x.com, B@Y.com";

  it("aceita só os emails da lista, sem diferenciar maiúsculas", () => {
    expect(isSignupAllowed("a@x.com", lista)).toBe(true);
    expect(isSignupAllowed("A@X.COM", lista)).toBe(true);
    expect(isSignupAllowed("b@y.com", lista)).toBe(true);
    expect(isSignupAllowed("c@z.com", lista)).toBe(false);
  });

  it("aceita qualquer email quando a variável está ausente ou vazia", () => {
    expect(isSignupAllowed("qualquer@x.com", undefined)).toBe(true);
    expect(isSignupAllowed("qualquer@x.com", "")).toBe(true);
    expect(isSignupAllowed("qualquer@x.com", "  ")).toBe(true);
  });
});

describe("parseTrustedOrigins", () => {
  it("mantém só URLs http/https, sem espaços nem barra final", () => {
    expect(
      parseTrustedOrigins("https://app.vercel.app/, http://localhost:5173 ,lixo,ftp://x"),
    ).toEqual(["https://app.vercel.app", "http://localhost:5173"]);
  });

  it("devolve lista vazia quando ausente ou vazia", () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
    expect(parseTrustedOrigins("")).toEqual([]);
  });
});
