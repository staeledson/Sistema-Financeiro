import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const { getMock, updateMock } = vi.hoisted(() => ({ getMock: vi.fn(), updateMock: vi.fn() }));

vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  return { ...mod, api: { ...mod.api, settings: { get: getMock, update: updateMock } } };
});

import AjustesView from "../AjustesView.vue";
import { useThemeStore } from "../../stores/theme";

const settings = { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Maria Silva", "Empresa LTDA"] };

async function mountView() {
  setActivePinia(createPinia());
  const w = mount(AjustesView);
  await flushPromises();
  return w;
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(settings);
  updateMock.mockReset().mockImplementation(async (b) => ({ ...settings, ...b }));
});

describe("AjustesView", () => {
  it("carrega os ajustes: nomes um por linha e números", async () => {
    const w = await mountView();
    expect((w.find("#owner-names").element as HTMLTextAreaElement).value).toBe("Maria Silva\nEmpresa LTDA");
    expect((w.find("#threshold").element as HTMLInputElement).value).toBe("0.8");
    expect((w.find("#batch").element as HTMLInputElement).value).toBe("40");
    expect((w.find("#window").element as HTMLInputElement).value).toBe("2");
    expect(w.text()).toContain("Abaixo disso o lançamento vai para Para categorizar");
    expect(w.text()).toContain("Pix entre as suas contas não é");
  });

  it("salva os valores convertidos e mostra confirmação", async () => {
    const w = await mountView();
    await w.find("#owner-names").setValue("Ana, Ana\nLoja X");
    await w.find("#threshold").setValue("0.6");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(updateMock).toHaveBeenCalledWith({ aiConfidenceThreshold: 0.6, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Ana", "Loja X"] });
    expect(w.text()).toContain("Ajustes salvos");
  });

  it("valores fora da faixa não são enviados e o erro aparece no campo", async () => {
    const w = await mountView();
    await w.find("#threshold").setValue("1.5");
    await w.find("#batch").setValue("0");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(updateMock).not.toHaveBeenCalled();
    expect(w.find("#threshold-err").text()).toContain("entre 0 e 1");
    expect(w.find("#batch-err").text()).toContain("1 e 200");
  });

  it("mais de 20 nomes é recusado, não cortado", async () => {
    const w = await mountView();
    await w.find("#owner-names").setValue(Array.from({ length: 21 }, (_, i) => `Nome ${i}`).join("\n"));
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(updateMock).not.toHaveBeenCalled();
    expect(w.find("#owner-err").text()).toContain("20");
  });

  it("mostra a mensagem da API quando o usuário não pode alterar", async () => {
    updateMock.mockRejectedValue(new Error("apenas owner ou admin alteram as configurações"));
    const w = await mountView();
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain("apenas owner ou admin");
    expect(w.text()).not.toContain("Ajustes salvos");
  });

  it("seletor de tema muda o modo do store", async () => {
    const w = await mountView();
    const radios = w.findAll('input[name="tema"]');
    expect(radios).toHaveLength(3);
    await radios[2].setValue(true);
    expect(useThemeStore().mode).toBe("dark");
    await radios[0].setValue(true);
    expect(useThemeStore().mode).toBe("system");
  });

  it("erro ao carregar: mostra e permite tentar de novo", async () => {
    getMock.mockRejectedValueOnce(new Error("sem conexão"));
    const w = await mountView();
    expect(w.find('[role="alert"]').text()).toContain("sem conexão");
    await w.find('[role="alert"] button').trigger("click");
    await flushPromises();
    expect(w.find("#owner-names").exists()).toBe(true);
  });
});
