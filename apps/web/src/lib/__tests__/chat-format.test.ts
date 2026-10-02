import { describe, expect, it } from "vitest";
import { escapeHtml, formatChatText } from "../chat-format";

describe("chat-format", () => {
  it("escapa HTML vindo do modelo", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
  it("mantém negrito e quebras de linha", () => {
    expect(formatChatText("Saldo: **R$ 10**\nok")).toBe("Saldo: <strong>R$ 10</strong><br>ok");
  });
  it("não deixa tag passar dentro do negrito", () => {
    expect(formatChatText("**<b>x</b>**")).toBe("<strong>&lt;b&gt;x&lt;/b&gt;</strong>");
  });
});
