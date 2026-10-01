import { describe, expect, it } from "vitest";
import { FORBIDDEN_SETTINGS_MESSAGE, formatOwnerNames, parseOwnerNames, settingsErrorMessage, validateSettingsForm } from "../settings-client";

describe("parseOwnerNames", () => {
  it("separa por vírgula e quebra de linha, sem vazios nem repetidos (maiúsculas ignoradas)", () => {
    expect(parseOwnerNames("Maria Silva, Empresa LTDA\nmaria silva")).toEqual(["Maria Silva", "Empresa LTDA"]);
    expect(parseOwnerNames(" ,\n\r\n  ,a ,, b\r\n")).toEqual(["a", "b"]);
    expect(parseOwnerNames("")).toEqual([]);
  });

  it("limita a 20 nomes", () => {
    const text = Array.from({ length: 25 }, (_, i) => `Nome ${i}`).join("\n");
    const out = parseOwnerNames(text);
    expect(out).toHaveLength(20);
    expect(out[19]).toBe("Nome 19");
  });
});

describe("formatOwnerNames", () => {
  it("faz o caminho inverso, um por linha", () => {
    expect(formatOwnerNames(["Maria Silva", "Empresa LTDA"])).toBe("Maria Silva\nEmpresa LTDA");
    expect(parseOwnerNames(formatOwnerNames(["a", "b"]))).toEqual(["a", "b"]);
    expect(formatOwnerNames([])).toBe("");
  });
});

describe("validateSettingsForm", () => {
  const ok = { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["a"] };

  it("aceita valores dentro das faixas (incluindo os limites)", () => {
    expect(validateSettingsForm(ok)).toEqual({ ok: true, value: ok });
    expect(validateSettingsForm({ ...ok, aiConfidenceThreshold: 0, aiBatchSize: 1, transferMatchWindowDays: 0, ownerNames: [] }).ok).toBe(true);
    expect(validateSettingsForm({ ...ok, aiConfidenceThreshold: 1, aiBatchSize: 200, transferMatchWindowDays: 10 }).ok).toBe(true);
  });

  it("recusa limiar fora de 0–1, lote fora de 1–200, janela fora de 0–10 e mais de 20 nomes, com a mensagem do campo", () => {
    const r1 = validateSettingsForm({ ...ok, aiConfidenceThreshold: 1.5 });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors).toEqual({ aiConfidenceThreshold: "Informe um valor entre 0 e 1." });

    const r2 = validateSettingsForm({ ...ok, aiBatchSize: 0 });
    if (!r2.ok) expect(r2.errors.aiBatchSize).toContain("1 e 200");
    else throw new Error("deveria recusar");

    const r3 = validateSettingsForm({ ...ok, transferMatchWindowDays: 11 });
    if (!r3.ok) expect(r3.errors.transferMatchWindowDays).toContain("0 e 10");
    else throw new Error("deveria recusar");

    const r4 = validateSettingsForm({ ...ok, ownerNames: Array.from({ length: 21 }, (_, i) => `n${i}`) });
    if (!r4.ok) expect(r4.errors.ownerNames).toContain("20");
    else throw new Error("deveria recusar");
  });

  it("recusa inteiros fracionados e valores não numéricos; reporta todos os erros juntos", () => {
    const r = validateSettingsForm({ ...ok, aiBatchSize: 2.5, transferMatchWindowDays: Number.NaN, aiConfidenceThreshold: -0.1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["aiBatchSize", "aiConfidenceThreshold", "transferMatchWindowDays"]);
  });
});

describe("settingsErrorMessage", () => {
  it("403 vira a mensagem em português, independente do texto da API", () => {
    const e = Object.assign(new Error("apenas owner ou admin alteram as configurações"), { status: 403 });
    expect(settingsErrorMessage(e)).toBe(FORBIDDEN_SETTINGS_MESSAGE);
    expect(FORBIDDEN_SETTINGS_MESSAGE).toBe("Somente o dono ou administradores do workspace podem alterar os ajustes.");
  });

  it("outros erros mantêm a mensagem; sem mensagem usa o texto padrão", () => {
    expect(settingsErrorMessage(Object.assign(new Error("campo inválido"), { status: 400 }))).toBe("campo inválido");
    expect(settingsErrorMessage(new Error(""))).toBe("Não foi possível salvar.");
    expect(settingsErrorMessage(null)).toBe("Não foi possível salvar.");
  });
});
