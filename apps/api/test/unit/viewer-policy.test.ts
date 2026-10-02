import { describe, expect, it } from "vitest";
import { viewerMayCall } from "../../src/auth/viewer-policy";

describe("viewerMayCall", () => {
  it("leitura sempre pode", () => {
    expect(viewerMayCall("GET", "/transactions?from=2026-01-01")).toBe(true);
    expect(viewerMayCall("GET", "/export/analise.csv")).toBe(true);
  });
  it("escrita no financeiro não pode", () => {
    expect(viewerMayCall("POST", "/transactions")).toBe(false);
    expect(viewerMayCall("PATCH", "/accounts/abc")).toBe(false);
    expect(viewerMayCall("DELETE", "/categories/abc")).toBe(false);
    expect(viewerMayCall("POST", "/import/x/commit")).toBe(false);
  });
  it("ações da própria conta e do chat podem", () => {
    expect(viewerMayCall("POST", "/invitations/accept")).toBe(true);
    expect(viewerMayCall("POST", "/workspaces")).toBe(true);
    expect(viewerMayCall("POST", "/push/subscribe")).toBe(true);
    expect(viewerMayCall("POST", "/chat")).toBe(true);
    expect(viewerMayCall("POST", "/workspaces/abc/members")).toBe(false);
  });
});
