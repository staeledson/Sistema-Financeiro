import { describe, it, expect } from "vitest";
import {
  describeSignupMode,
  isSignupAllowed,
  parseTrustedOrigins,
  signupMode,
} from "../../src/auth/signup-policy";

describe("isSignupAllowed", () => {
  const lista = "a@x.com, B@Y.com";

  it("aceita só os emails da lista, sem diferenciar maiúsculas (em qualquer ambiente)", () => {
    for (const env of ["production", "development", "test"]) {
      expect(isSignupAllowed("a@x.com", lista, env)).toBe(true);
      expect(isSignupAllowed("A@X.COM", lista, env)).toBe(true);
      expect(isSignupAllowed("b@y.com", lista, env)).toBe(true);
      expect(isSignupAllowed("c@z.com", lista, env)).toBe(false);
    }
  });

  it("fora de produção, variável ausente ou vazia aceita qualquer email", () => {
    for (const env of ["development", "test", undefined]) {
      expect(isSignupAllowed("qualquer@x.com", undefined, env)).toBe(true);
      expect(isSignupAllowed("qualquer@x.com", "", env)).toBe(true);
      expect(isSignupAllowed("qualquer@x.com", "  ", env)).toBe(true);
      expect(isSignupAllowed("qualquer@x.com", " , ", env)).toBe(true);
    }
  });

  it("em produção, variável ausente ou vazia recusa todo mundo (falha segura)", () => {
    expect(isSignupAllowed("qualquer@x.com", undefined, "production")).toBe(false);
    expect(isSignupAllowed("qualquer@x.com", "", "production")).toBe(false);
    expect(isSignupAllowed("qualquer@x.com", "  ", "production")).toBe(false);
    expect(isSignupAllowed("qualquer@x.com", " , ", "production")).toBe(false);
  });

  it("'*' (exatamente) abre o cadastro, inclusive em produção", () => {
    expect(isSignupAllowed("qualquer@x.com", "*", "production")).toBe(true);
    expect(isSignupAllowed("qualquer@x.com", " * ", "production")).toBe(true);
    expect(isSignupAllowed("qualquer@x.com", "*", "development")).toBe(true);
  });

  it("'*' misturado a emails não abre o cadastro", () => {
    expect(isSignupAllowed("c@z.com", "a@x.com,*", "production")).toBe(false);
    expect(isSignupAllowed("a@x.com", "a@x.com,*", "production")).toBe(true);
  });

  it("lê NODE_ENV de process.env a cada chamada quando não informado", () => {
    const antes = process.env["NODE_ENV"];
    try {
      process.env["NODE_ENV"] = "production";
      expect(isSignupAllowed("x@y.com", undefined)).toBe(false);
      process.env["NODE_ENV"] = "test";
      expect(isSignupAllowed("x@y.com", undefined)).toBe(true);
    } finally {
      process.env["NODE_ENV"] = antes;
    }
  });
});

describe("signupMode / describeSignupMode", () => {
  it("descreve cada modo sem expor emails", () => {
    expect(describeSignupMode(signupMode("a@x.com, b@y.com", "production"))).toBe("allowlist (2 emails)");
    expect(describeSignupMode(signupMode("*", "production"))).toBe("aberto (*)");
    expect(describeSignupMode(signupMode("", "production"))).toBe("fechado");
    expect(describeSignupMode(signupMode(undefined, "development"))).toBe("aberto (*)");
    expect(describeSignupMode(signupMode("a@x.com", "production"))).not.toContain("a@x.com");
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
