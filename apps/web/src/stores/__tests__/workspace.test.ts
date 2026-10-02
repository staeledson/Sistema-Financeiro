import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const httpMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/http", () => ({ http: httpMock }));

import { useWorkspaceStore } from "../workspace";
import { useAuthStore } from "../auth";

describe("workspace store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    httpMock.mockReset();
    useAuthStore().token = "tok";
  });

  it("setActive persiste e load respeita o id salvo", async () => {
    httpMock.mockResolvedValue([{ id: "w1", type: "personal", name: "P" }, { id: "w2", type: "family", name: "F" }]);
    const s = useWorkspaceStore();
    s.setActive("w2");
    expect(localStorage.getItem("workspace-active")).toBe("w2");
    setActivePinia(createPinia());
    useAuthStore().token = "tok";
    const again = useWorkspaceStore();
    await again.load();
    expect(again.activeId).toBe("w2");
  });

  it("id salvo que não existe mais cai no primeiro workspace", async () => {
    localStorage.setItem("workspace-active", "sumiu");
    httpMock.mockResolvedValue([{ id: "w1", type: "personal", name: "P" }]);
    const s = useWorkspaceStore();
    await s.load();
    expect(s.activeId).toBe("w1");
  });
});
