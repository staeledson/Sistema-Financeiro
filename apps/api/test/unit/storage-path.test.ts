import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertWorkspacePath, belongsToWorkspace } from "../../src/storage/storage-path";

describe("storage-path", () => {
  it("aceita só chaves do próprio workspace", () => {
    expect(belongsToWorkspace("ws1/abc.jpg", "ws1")).toBe(true);
    expect(belongsToWorkspace("ws2/abc.jpg", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws1", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws1/", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws1/../ws2/abc.jpg", "ws1")).toBe(false);
    expect(belongsToWorkspace("/ws1/abc.jpg", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws10/abc.jpg", "ws1")).toBe(false);
  });
  it("assert lança 400", () => {
    expect(() => assertWorkspacePath("ws2/x.jpg", "ws1")).toThrow(BadRequestException);
    expect(() => assertWorkspacePath("ws1/x.jpg", "ws1")).not.toThrow();
  });
});
