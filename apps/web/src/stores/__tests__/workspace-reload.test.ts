import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuthStore } from "../auth";
import { useWorkspaceStore } from "../workspace";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

describe("workspace store com http real", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
  });

  it("workspace salvo inválido (403) não desloga: tenta de novo sem o cabeçalho e cai no primeiro", async () => {
    localStorage.setItem("workspace-active", "sumiu");
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.token = "tok123";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(403, { message: "não é membro deste workspace" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ id: "w1", type: "personal", name: "Pessoal", currency: "BRL" }]));

    const ws = useWorkspaceStore();
    await ws.load();

    expect(auth.token).toBe("tok123");
    expect(ws.activeId).toBe("w1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers["x-workspace-id"]).toBe("sumiu");
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("x-workspace-id");
  });
});
