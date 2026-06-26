import { describe, it, expect } from "vitest";
import { PING } from "../index";
describe("shared", () => {
  it("exporta um valor", () => { expect(PING).toBe("pong"); });
});
