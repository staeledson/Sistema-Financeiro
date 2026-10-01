import { describe, it, expect } from "vitest";
import { applyRules, ruleFromCorrection } from "../rules";

const rules = [
  { matchType: "contains" as const, pattern: "ifood", categoryId: "c-rest", priority: 100 },
  { matchType: "equals" as const, pattern: "uber", categoryId: "c-transp", priority: 90 },
];

describe("applyRules", () => {
  it("casa por contains (case-insensitive)", () => {
    expect(applyRules("Compra IFOOD SP", rules)).toBe("c-rest");
  });
  it("respeita prioridade — equals sobre contains quando ambos casam", () => {
    const both = [
      { matchType: "contains" as const, pattern: "uber", categoryId: "c-cont", priority: 90 },
      { matchType: "equals" as const, pattern: "uber", categoryId: "c-transp", priority: 95 },
    ];
    expect(applyRules("uber", both)).toBe("c-transp");
  });
  it("equals não casa substring", () => {
    expect(applyRules("ubereats", rules)).toBeNull();
  });
  it("sem match → null", () => {
    expect(applyRules("posto shell", rules)).toBeNull();
  });
  it("regex funciona", () => {
    const r = [{ matchType: "regex" as const, pattern: "^netflix", categoryId: "c-assin", priority: 100 }];
    expect(applyRules("Netflix.com pagamento", r)).toBe("c-assin");
    expect(applyRules("pagar netflix", r)).toBeNull();
  });
});

describe("matchRule ignora acento e caixa", () => {
  it("contains e equals comparam sem acento", () => {
    const r = [
      { matchType: "contains" as const, pattern: "padaria são joão", categoryId: "c-pad", priority: 100 },
      { matchType: "equals" as const, pattern: "Café", categoryId: "c-cafe", priority: 90 },
    ];
    expect(applyRules("PADARIA SAO JOAO", r)).toBe("c-pad");
    expect(applyRules("padaria SÃO joão 12/03", r)).toBe("c-pad");
    expect(applyRules("CAFE", r)).toBe("c-cafe");
    expect(applyRules("cafeteria", r)).toBeNull();
  });
  it("regex continua sobre o texto cru", () => {
    const r = [{ matchType: "regex" as const, pattern: "^padaria sao", categoryId: "c-pad", priority: 100 }];
    expect(applyRules("PADARIA SÃO JOÃO", r)).toBeNull();
    expect(applyRules("PADARIA SAO JOAO", r)).toBe("c-pad");
  });
  it("padrão em forma de chave casa contra a chave do texto (pontuação e dígitos)", () => {
    const r = [{ matchType: "contains" as const, pattern: "netflix com", categoryId: "c-assin", priority: 100 }];
    expect(applyRules("NETFLIX.COM 02/2026", r)).toBe("c-assin");
  });
  it("padrão com dígitos continua literal", () => {
    const r = [{ matchType: "contains" as const, pattern: "padaria 2", categoryId: "c-pad", priority: 100 }];
    expect(applyRules("padaria 3", r)).toBeNull();
    expect(applyRules("padaria 2", r)).toBe("c-pad");
  });
});

describe("ruleFromCorrection", () => {
  const rule = (description: string, counterparty: string | null = null) =>
    ruleFromCorrection({ counterparty, description }, "c-x");

  it("deriva contains da chave normalizada do fornecedor", () => {
    const r = ruleFromCorrection({ counterparty: "Netflix.com", description: null }, "c-assin");
    expect(r).toEqual({ matchType: "contains", pattern: "netflix com", categoryId: "c-assin", priority: 120 });
  });
  it("cai para description se não há counterparty", () => {
    expect(rule("IFOOD SP 123")!.pattern).toBe("ifood sp");
  });
  it("trunca em 3 palavras", () => {
    expect(ruleFromCorrection({ counterparty: "Mercado Livre Extra Longa Descricao" }, "c-merc")!.pattern).toBe("mercado livre extra");
  });
  it("tira dígitos e acentos: Netflix 01/2026 casa NETFLIX 02/2026", () => {
    const r = rule("Netflix 01/2026")!;
    expect(r.pattern).toBe("netflix");
    expect(applyRules("NETFLIX 02/2026", [r])).toBe("c-x");
  });
  it("iFood *Pedido 111 casa o pedido do mês seguinte", () => {
    const r = rule("iFood *Pedido 111")!;
    expect(applyRules("IFOOD *PEDIDO 222", [r])).toBe("c-x");
  });
  it("padaria são joão casa PADARIA SAO JOAO", () => {
    const r = rule("padaria são joão")!;
    expect(applyRules("PADARIA SAO JOAO", [r])).toBe("c-x");
  });
  it("Pix enviado para Padaria do Bairro: ignora o prefixo e não captura outro Pix", () => {
    const r = rule("Pix enviado para Padaria do Bairro")!;
    expect(r.pattern).toBe("padaria do bairro");
    expect(applyRules("PIX ENVIADO PARA PADARIA DO BAIRRO 12/03", [r])).toBe("c-x");
    expect(applyRules("Pix enviado para Farmácia X", [r])).toBeNull();
  });
  it("Pix recebido de Cliente A: baseia-se em cliente, não em pix recebido de", () => {
    const r = rule("Pix recebido de Cliente A")!;
    expect(r.pattern.startsWith("cliente")).toBe(true);
    expect(r.pattern).not.toContain("pix");
    expect(applyRules("Pix recebido de Outro Cliente", [r])).toBeNull();
  });
  it("remove prefixos encadeados (compra no débito, ted, débito automático, pagamento de)", () => {
    expect(rule("Compra no débito Mercado Extra")!.pattern).toBe("mercado extra");
    expect(rule("COMPRA CREDITO Posto Shell")!.pattern).toBe("posto shell");
    expect(rule("TED enviada Maria Souza")!.pattern).toBe("maria souza");
    expect(rule("Transferência recebida de João Silva")!.pattern).toBe("joao silva");
    expect(rule("Débito automático Enel Energia")!.pattern).toBe("enel energia");
    expect(rule("Pagamento de Condomínio Azul")!.pattern).toBe("condominio azul");
    expect(rule("Pix para Pix enviado Loja Y")!.pattern).toBe("loja y");
  });
  it("sem nome de fornecedor depois dos termos de operação → null (nunca uma regra ampla)", () => {
    expect(rule("Compra com Pix")).toBeNull();
    expect(rule("TRANSF PIX")).toBeNull();
    expect(rule("PGTO PIX")).toBeNull();
    expect(rule("PIX QR CODE")).toBeNull();
    expect(rule("Pagamento via Pix")).toBeNull();
    expect(rule("Envio cartão")).toBeNull();
  });
  it("conectores e termos de operação no começo saem, o nome do fornecedor fica", () => {
    expect(rule("Transferência enviada pelo Pix - MARIA X")!.pattern).toBe("maria x");
    expect(rule("PIX QR CODE Padaria Central")!.pattern).toBe("padaria central");
    expect(rule("PGTO PIX Loja Azul 12")!.pattern).toBe("loja azul");
    expect(rule("Compra com cartão Farmácia Pague Menos")!.pattern).toBe("farmacia pague menos");
  });
  it("Pix enviado para Padaria do Bairro continua gerando regra baseada em padaria", () => {
    const r = rule("Pix enviado para Padaria do Bairro")!;
    expect(r.pattern).toBe("padaria do bairro");
    expect(applyRules("Pix enviado para Farmácia X", [r])).toBeNull();
  });
  it("só operação, vazio ou curto → null", () => {
    expect(rule("Pix enviado")).toBeNull();
    expect(rule("Pix recebido de")).toBeNull();
    expect(rule("Pagamento")).toBeNull();
    expect(rule("Compra no débito")).toBeNull();
    expect(rule("TED")).toBeNull();
    expect(rule("Transferência enviada para")).toBeNull();
    expect(rule("12345")).toBeNull();
    expect(rule("***")).toBeNull();
    expect(rule("ab")).toBeNull();
    expect(ruleFromCorrection({ counterparty: null, description: null }, "c")).toBeNull();
  });
});
