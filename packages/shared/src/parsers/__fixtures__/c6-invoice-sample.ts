/** Fatura CSV do C6 MASCARADA: titular, comerciantes e finais de cartão inventados (nunca dados reais). */
export const C6_INVOICE_HEADER =
  "Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)";

const NAME = "NOME TITULAR";

/** Linhas na ordem em que aparecem no arquivo (dois cartões intercalados). */
export const C6_INVOICE_ROWS: string[] = [
  `05/09/2026;${NAME};1111;Restaurante / Lanchonete / Bar;CAFE  CENTRAL;Única;0;0;12.50`,
  `05/09/2026;${NAME};1111;Restaurante / Lanchonete / Bar;CAFE  CENTRAL;Única;0;0;12.50`,
  `06/09/2026;${NAME};2222;Supermercados / Mercearias;MERCADO BOM PRECO;Única;0;0;250.90`,
  `08/09/2026;${NAME};1111;Impostos;IOF COMPRA INTERNACIONAL;Única;0;0;0.31`,
  `08/09/2026;${NAME};1111;Entretenimento;SERVICO STREAMING;Única;5.00;5.44;27.20`,
  `10/09/2026;${NAME};1111;Vestuário;LOJA MODA CENTRO;3/10;0;0;120.00`,
  `11/09/2026;${NAME};2222;Elétrico;OFICINA ELETRICA SILVA;Única;0;0;80.00`,
  `12/09/2026;${NAME};1111;Eletrônicos;MERCADO TECH;2 de 6;0;0;300.00`,
  `14/09/2026;${NAME};1111;Serviços;LOJA ZERO;Única;0;0;0.00`,
  `15/09/2026;${NAME};1111;-;Pagamento recebido;Única;0;0;-500.00`,
];

export function c6InvoiceText(opts: { bom?: boolean; crlf?: boolean; rows?: string[] } = {}): string {
  const eol = opts.crlf ? "\r\n" : "\n";
  const body = [C6_INVOICE_HEADER, ...(opts.rows ?? C6_INVOICE_ROWS)].join(eol) + eol;
  return (opts.bom ? "﻿" : "") + body;
}
