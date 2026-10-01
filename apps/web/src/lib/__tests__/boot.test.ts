import { describe, expect, it, vi } from "vitest";
import { mountWhenReady } from "../boot";

describe("mountWhenReady", () => {
  it("monta depois que a navegação inicial termina", async () => {
    const mount = vi.fn();
    await mountWhenReady(() => Promise.resolve(), mount);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("monta mesmo se a navegação inicial falhar", async () => {
    const mount = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await mountWhenReady(() => Promise.reject(new Error("guard")), mount);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
