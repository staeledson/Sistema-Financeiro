import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuthStore } from "../../stores/auth";
import { useWorkspaceStore } from "../../stores/workspace";
import { http, HttpError, authHeaders } from "../http";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMock.mockReset();
  useAuthStore().token = "tok123";
  useWorkspaceStore().activeId = "ws_abc";
});

describe("http", () => {
  it("envia authorization e x-workspace-id em GET, sem content-type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: 1 }]));
    const data = await http<Array<{ id: number }>>("GET", "/accounts");
    expect(data).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/accounts");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ authorization: "Bearer tok123", "x-workspace-id": "ws_abc" });
    expect(init.body).toBeUndefined();
  });

  it("serializa body e envia content-type em POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "x" }));
    await http("POST", "/accounts", { name: "Nubank" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "Nubank" }));
  });

  it("omite x-workspace-id quando não há workspace ativo", async () => {
    useWorkspaceStore().activeId = null;
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await http("GET", "/workspaces");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-workspace-id"]).toBeUndefined();
  });

  it("lança HttpError com a mensagem do corpo JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: "conta inexistente", statusCode: 400 }));
    await expect(http("GET", "/x")).rejects.toMatchObject({ status: 400, message: "conta inexistente" });
    await expect(http("GET", "/x")).rejects.toBeInstanceOf(HttpError);
  });

  it("lança HttpError com o texto quando o corpo não é JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, "boom"));
    await expect(http("GET", "/x")).rejects.toMatchObject({ status: 500, message: "boom" });
  });

  it("retorna undefined em corpo vazio", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "", json: async () => { throw new Error("no body"); } });
    await expect(http("DELETE", "/x")).resolves.toBeUndefined();
  });

  it("401 encerra a sessão local e lança HttpError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));
    await expect(http("GET", "/accounts")).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore().token).toBeNull();
  });

  it("authHeaders expõe só authorization e x-workspace-id", () => {
    expect(authHeaders()).toEqual({ authorization: "Bearer tok123", "x-workspace-id": "ws_abc" });
  });
});
