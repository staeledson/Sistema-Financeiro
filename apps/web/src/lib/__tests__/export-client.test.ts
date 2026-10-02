import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { downloadAnalysisCsv } from "../export-client";
import { HttpError } from "../http";

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.restoreAllMocks());

describe("downloadAnalysisCsv", () => {
  it("chama o endpoint com a autenticação e dispara o download do arquivo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("a,b\n1,2", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadAnalysisCsv();

    expect(String(fetchMock.mock.calls[0][0])).toContain("/export/analise.csv");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toMatch(/^Bearer /);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });

  it("resposta de erro vira HttpError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(downloadAnalysisCsv()).rejects.toBeInstanceOf(HttpError);
  });
});
