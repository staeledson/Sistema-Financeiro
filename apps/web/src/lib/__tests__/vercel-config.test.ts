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

const MARCADOR = "API_PUBLICA";

/**
 * Valida os destinos das duas regras de /api: ou o marcador literal (antes do deploy da API), ou um
 * https://<host> real (host com ponto, sem localhost, sem porta, sem barra no final) igual nas duas regras.
 * Devolve a descrição do problema, ou null se estiver válido.
 */
function validarDestinosApi(rewrites: Rewrite[]): string | null {
  const auth = rewrites.find((r) => r.source === "/api/auth/:path*");
  const api = rewrites.find((r) => r.source === "/api/:path*");
  if (!auth || !api) return "faltam as regras /api/auth/:path* e /api/:path*";
  const m1 = /^https:\/\/([^/]+)\/api\/auth\/:path\*$/.exec(auth.destination);
  const m2 = /^https:\/\/([^/]+)\/:path\*$/.exec(api.destination);
  if (!m1 || !m2) return "destino precisa ser https://<host>/api/auth/:path* e https://<host>/:path* (sem barra extra)";
  if (m1[1] !== m2[1]) return "as duas regras apontam para hosts diferentes";
  const host = m1[1];
  if (host === MARCADOR) return null;
  if (/^(localhost|127\.|\[::1\])/i.test(host)) return "host não pode ser localhost";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    return "host inválido (precisa de domínio com ponto, sem porta nem barra)";
  }
  return null;
}

const regrasCom = (hostAuth: string, hostApi: string = hostAuth): Rewrite[] => [
  { source: "/api/auth/:path*", destination: `${hostAuth}/api/auth/:path*` },
  { source: "/api/:path*", destination: `${hostApi}/:path*` },
];

// Converte um source simples de path-to-regexp (com grupo regex entre parênteses) em RegExp ancorada.
function compilarFallback(source: string): RegExp {
  return new RegExp(`^${source}$`);
}

describe("vercel.json", () => {
  it("é um JSON válido com a configuração de build do monorepo", () => {
    expect(config.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    expect(config.framework).toBe("vite");
    expect(config.installCommand).toBe("cd ../.. && pnpm install --frozen-lockfile --filter @app/web...");
    expect(config.buildCommand).toBe("pnpm --filter @app/web build");
    expect(config.outputDirectory).toBe("dist");
  });

  it("reescreve /api/auth mantendo o prefixo e /api removendo o prefixo, como o proxy do Vite", () => {
    const auth = config.rewrites.find((r) => r.source === "/api/auth/:path*");
    const api = config.rewrites.find((r) => r.source === "/api/:path*");
    expect(auth?.destination).toMatch(/^https:\/\/[^/]+\/api\/auth\/:path\*$/);
    expect(api?.destination).toMatch(/^https:\/\/[^/]+\/:path\*$/);
  });

  it("os destinos de /api são o marcador API_PUBLICA ou um https://<host> real, igual nas duas regras", () => {
    expect(validarDestinosApi(config.rewrites)).toBeNull();
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

  it("o fallback SPA também não captura /assets/*, para um chunk ausente dar 404 em vez de HTML", () => {
    const re = compilarFallback(config.rewrites[2].source);
    expect(config.rewrites[2].source).toBe("/((?!api/|assets/).*)");
    expect(re.test("/assets/index-abc123.js")).toBe(false);
    expect(re.test("/assets-lista")).toBe(true);
  });

  it("sem marcador, os destinos reais não usam localhost nem barra final (ver validarDestinosApi)", () => {
    const comMarcador = config.rewrites.filter((r) => r.destination.includes(MARCADOR));
    expect([0, 2]).toContain(comMarcador.length);
    expect(texto).not.toMatch(/localhost|http:\/\//);
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

  it("cache imutável em /assets e sem cache no service worker (o index.html já é revalidado por padrão na Vercel)", () => {
    const cache = (source: string) =>
      config.headers
        .find((h) => h.source === source)
        ?.headers.find((h) => h.key === "Cache-Control")?.value;
    expect(cache("/assets/(.*)")).toBe("public, max-age=31536000, immutable");
    expect(cache("/sw.js")).toBe("public, max-age=0, must-revalidate");
    // Regra morta removida: a Vercel já serve arquivos estáticos fora de /assets com max-age=0, must-revalidate.
    expect(config.headers.find((h) => h.source === "/index.html")).toBeUndefined();
  });

  it("não contém segredo nem dado pessoal", () => {
    expect(texto).not.toMatch(/sk-[A-Za-z0-9]{10,}|secret|password|token|api[_-]?key|@[A-Za-z0-9-]+\.(com|br)/i);
  });
});

describe("validarDestinosApi", () => {
  const host = "minha-api.up.railway.app"; // fabricado, só para o teste

  it("aceita o marcador literal e um host https válido", () => {
    expect(validarDestinosApi(regrasCom(`https://${MARCADOR}`))).toBeNull();
    expect(validarDestinosApi(regrasCom(`https://${host}`))).toBeNull();
  });

  it("recusa localhost, http, barra final, porta, host sem ponto e hosts diferentes", () => {
    expect(validarDestinosApi(regrasCom("https://localhost"))).toMatch(/localhost/);
    expect(validarDestinosApi(regrasCom("https://localhost:3100"))).toMatch(/localhost/);
    expect(validarDestinosApi(regrasCom(`http://${host}`))).toMatch(/https/);
    expect(validarDestinosApi(regrasCom(`https://${host}/`))).toMatch(/barra|https/);
    expect(validarDestinosApi(regrasCom(`https://${host}:8080`))).toMatch(/inválido/);
    expect(validarDestinosApi(regrasCom("https://minha-api"))).toMatch(/inválido/);
    expect(validarDestinosApi(regrasCom(`https://${host}`, "https://outra-api.up.railway.app"))).toMatch(/diferentes/);
  });

  it("recusa quando falta uma das regras de /api", () => {
    expect(validarDestinosApi([regrasCom(`https://${host}`)[0]])).toMatch(/faltam/);
  });
});
