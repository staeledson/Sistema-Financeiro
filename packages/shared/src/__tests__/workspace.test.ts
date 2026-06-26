import { describe, it, expect } from "vitest";
import { workspaceSchema, WORKSPACE_TYPES, MEMBER_ROLES } from "../index";

describe("workspaceSchema", () => {
  it("aceita um workspace válido", () => {
    const ok = workspaceSchema.safeParse({
      id: "clwspc0001",
      type: "personal",
      name: "Pessoal",
      currency: "BRL",
      createdById: "clusr00001",
    });
    expect(ok.success).toBe(true);
  });

  it("rejeita type inválido", () => {
    const bad = workspaceSchema.safeParse({
      id: "clwspc0001",
      type: "invalid",
      name: "X",
      currency: "BRL",
      createdById: "clusr00001",
    });
    expect(bad.success).toBe(false);
  });

  it("rejeita currency fora de 3 letras", () => {
    const bad = workspaceSchema.safeParse({
      id: "clwspc0001",
      type: "personal",
      name: "X",
      currency: "BRLL",
      createdById: "clusr00001",
    });
    expect(bad.success).toBe(false);
  });

  it("expõe os enums esperados", () => {
    expect(WORKSPACE_TYPES).toEqual(["personal", "family", "business"]);
    expect(MEMBER_ROLES).toEqual(["owner", "admin", "member", "viewer"]);
  });
});
