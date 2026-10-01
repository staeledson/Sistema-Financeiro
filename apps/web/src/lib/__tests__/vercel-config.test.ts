import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Rewrite = { source: string; destination: string };
type Header = { source: string; headers: { key: string; value: string }[] };
type VercelConfig = {
  $schema?: string;
  framework?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  rewrites: Rewrite[];
  headers: Header[];
};

// O Vitest roda a partir de apps/web (cwd do pacote @app/web).
const caminho = resolve(process.cwd(), "vercel.json");
const texto = readFileSync(caminho, "utf8");
const config = JSON.parse(texto) as VercelConfig;

// Converte um source simples de path-to-regexp (com grupo regex entre parênteses) em RegExp ancorada.
function compilarFallback(source: string): RegExp {
  return new RegExp(`^${source}$`);
}

describe("vercel.json", () => {
  it("é um JSON válido com a configuração de build do monorepo", () => {
    expect(config.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    expect(config.framework).toBe("vite");
    expect(config.installCommand).toBe("cd ../.. && pnpm install --frozen-lockfile");
    expect(config.buildCommand).toBe("pnpm --filter @app/web build");
    expect(config.outputDirectory).toBe("dist");
  });

  it("reescreve /api/auth mantendo o prefixo e /api removendo o prefixo, como o proxy do Vite", () => {
    expect(config.rewrites[0]).toEqual({
      source: "/api/auth/:path*",
      destination: "https://API_PUBLICA/api/auth/:path*",
    });
    expect(config.rewrites[1]).toEqual({
      source: "/api/:path*",
      destination: "https://API_PUBLICA/:path*",
    });
  });

  it("as duas regras de /api vêm antes do fallback SPA, que serve /index.html", () => {
    expect(config.rewrites).toHaveLength(3);
    const fallback = config.rewrites[2];
    expect(fallback.destination).toBe("/index.html");
    expect(config.rewrites.findIndex((r) => r.source === "/api/auth/:path*")).toBeLessThan(2);
    expect(config.rewrites.findIndex((r) => r.source === "/api/:path*")).toBeLessThan(2);
  });

  it("o fallback SPA não captura /api/* mas captura as rotas do app", () => {
    const re = compilarFallback(config.rewrites[2].source);
    expect(re.test("/api/transactions")).toBe(false);
    expect(re.test("/api/auth/sign-in/email")).toBe(false);
    expect(re.test("/")).toBe(true);
    expect(re.test("/painel")).toBe(true);
    expect(re.test("/lancar/compartilhado")).toBe(true);
  });

  it("o marcador API_PUBLICA aparece em exatamente duas regras (a troca é feita na Task 5)", () => {
    const comMarcador = config.rewrites.filter((r) => r.destination.includes("API_PUBLICA"));
    expect(comMarcador).toHaveLength(2);
    expect(texto.match(/API_PUBLICA/g)).toHaveLength(2);
  });

  it("define cabeçalhos de segurança para todas as rotas", () => {
    const geral = config.headers.find((h) => h.source === "/(.*)");
    expect(geral).toBeDefined();
    const mapa = Object.fromEntries(geral!.headers.map((h) => [h.key, h.value]));
    expect(mapa["X-Content-Type-Options"]).toBe("nosniff");
    expect(mapa["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(mapa["X-Frame-Options"]).toBe("DENY");
    expect(mapa["Permissions-Policy"]).toBeTruthy();
  });

  it("cache imutável em /assets e sem cache no service worker e no index.html", () => {
    const cache = (source: string) =>
      config.headers
        .find((h) => h.source === source)
        ?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(cache("/assets/(.*)")).toBe("public, max-age=31536000, immutable");
    expect(cache("/sw.js")).toBe("public, max-age=0, must-revalidate");
    expect(cache("/index.html")).toBe("public, max-age=0, must-revalidate");
  });

  it("não contém segredo nem dado pessoal", () => {
    expect(texto).not.toMatch(/sk-[A-Za-z0-9]{10,}|secret|password|token|api[_-]?key|@[A-Za-z0-9-]+\.(com|br)/i);
  });
});
