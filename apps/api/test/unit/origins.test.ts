import { describe, it, expect } from "vitest";
import { baseUrlWarning, buildTrustedOrigins, normalizeBaseUrl } from "../../src/auth/origins";

describe("normalizeBaseUrl", () => {
  it("remove espaços e barras finais", () => {
    expect(normalizeBaseUrl(" https://app.vercel.app// ")).toBe("https://app.vercel.app");
  });
  it("usa a API local quando ausente ou vazia", () => {
    expect(normalizeBaseUrl(undefined)).toBe("http://localhost:3100");
    expect(normalizeBaseUrl("  ")).toBe("http://localhost:3100");
  });
});

describe("buildTrustedOrigins", () => {
  it("fora de produção inclui o Vite local e TRUSTED_ORIGINS", () => {
    const o = buildTrustedOrigins("http://localhost:3100", "https://x.app/", "development");
    expect(o).toContain("http://localhost:3100");
    expect(o).toContain("http://localhost:5173");
    expect(o).toContain("http://127.0.0.1:5174");
    expect(o).toContain("https://x.app");
  });

  it("em produção não inclui localhost, só a base e TRUSTED_ORIGINS", () => {
    const o = buildTrustedOrigins("https://app.vercel.app", "https://outro.app", "production");
    expect(o).toEqual(["https://app.vercel.app", "https://outro.app"]);
  });

  it("não repete origens", () => {
    const o = buildTrustedOrigins("https://a.app", "https://a.app,https://a.app/", "production");
    expect(o).toEqual(["https://a.app"]);
  });
});

describe("baseUrlWarning", () => {
  it("avisa em produção quando ausente ou localhost", () => {
    expect(baseUrlWarning(undefined, "production")).toMatch(/não definida/);
    expect(baseUrlWarning("http://localhost:3100", "production")).toMatch(/localhost/);
    expect(baseUrlWarning("http://127.0.0.1:3100", "production")).toMatch(/localhost/);
  });
  it("não avisa com URL pública em produção nem fora de produção", () => {
    expect(baseUrlWarning("https://app.vercel.app", "production")).toBeNull();
    expect(baseUrlWarning(undefined, "development")).toBeNull();
    expect(baseUrlWarning("http://localhost:3100", "test")).toBeNull();
  });
});
