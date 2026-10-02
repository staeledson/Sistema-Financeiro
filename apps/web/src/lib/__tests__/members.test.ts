import { describe, expect, it } from "vitest";
import { canManageMembers } from "../members";

const members = [
  { role: "owner", user: { id: "u1" } },
  { role: "viewer", user: { id: "u2" } },
];

describe("canManageMembers", () => {
  it("owner e admin podem; viewer não; sem usuário não", () => {
    expect(canManageMembers(members, "u1")).toBe(true);
    expect(canManageMembers(members, "u2")).toBe(false);
    expect(canManageMembers(members, null)).toBe(false);
    expect(canManageMembers([{ role: "admin", user: { id: "u3" } }], "u3")).toBe(true);
  });
});
