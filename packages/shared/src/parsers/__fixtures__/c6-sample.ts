/**
 * Extrato C6 sintético (dados fictícios) no formato de texto do pdf-parse:
 * colunas separadas por " \t". Com `layout: true` usa 3+ espaços (formato do pdftotext -layout).
 */
export const C6_SAMPLE = {
  conta: "123456789",
  rowCount: 9,
  period: { from: "2025-10-01", to: "2025-11-05" },
  /** Pontos de saldo: 4 "Saldo do dia" + o saldo do cabeçalho. */
  balances: [
    { dateISO: "2025-10-02", balanceCents: 84950 },
    { dateISO: "2025-10-10", balanceCents: 80950 },
    { dateISO: "2025-10-29", balanceCents: 76000 },
    { dateISO: "2025-11-03", balanceCents: 51000 },
    { dateISO: "2025-11-05", balanceCents: 50000 },
  ],
  checkpoints: 4,
} as const;

export function c6SampleText(opts: { layout?: boolean; corruptBalance?: boolean } = {}): string {
  const sep = opts.layout ? "      " : " \t";
  const row = (...cells: string[]) => cells.join(sep);
  // "Saldo do dia 29/10/25" correto = R$ 760,00; corrompido = R$ 769,50 (esquece a tarifa de R$ 9,50)
  const saldo29 = opts.corruptBalance ? "R$ 769,50" : "R$ 760,00";

  return [
    "Extrato exportado no dia 5 de novembro de 2025 às 16:20",
    "FULANO DE TESTE • 000.000.000-00",
    `Agência: 1 • Conta: ${C6_SAMPLE.conta}`,
    "Extrato Período • 1 de outubro de 2025 até 5 de novembro de 2025",
    "Saldo do dia • 5 de novembro de 2025 • R$ 500,00",
    `Outubro 2025 ( 01/10/2025 - 31/10/2025 )${sep}Entradas: R$ 1.000,00 • Saídas: R$ 719,50`,
    "Data",
    "lançamento",
    "Data",
    row("contábil", "Tipo", "Descrição", "Valor"),
    row("02/10", "02/10", "Entrada PIX", "Pix recebido de Cliente A", "R$ 1.000,00"),
    row("02/10", "02/10", "Saída PIX", "Pix enviado para Mercado X", "-R$ 250,50"),
    row("Saldo do dia 02/10/25", "R$ 849,50"),
    row("10/10", "10/10", "Saída PIX", "Pix enviado para Padaria", "-R$ 20,00"),
    row("10/10", "10/10", "Saída PIX", "Pix enviado para Padaria", "-R$ 20,00"),
    row("Saldo do dia 10/10/25", "R$ 809,50"),
    row("29/10", "29/10", "Saída PIX", "Pix enviado para Loja", "-R$ 40,00"),
    row("Saldo do dia 29/10/25", saldo29),
    // pertence ao saldo de 29/10 (contábil 28/10), mas o extrato a lista depois dele
    row("28/10", "28/10", "Outros gastos", "Tarifa de manutenção", "-R$ 9,50"),
    // lançada em 29/10, contábil em 01/11 (já no mês seguinte, após o saldo de 29/10), listada no bloco de outubro
    row("29/10", "01/11", "Pagamento", "PGTO FAT CARTAO C6", "-R$ 300,00"),
    `Novembro 2025 ( 01/11/2025 - 30/11/2025 )${sep}Entradas: R$ 50,00 • Saídas: R$ 10,00`,
    "Data",
    "lançamento",
    "Data",
    row("contábil", "Tipo", "Descrição", "Valor"),
    row("03/11", "03/11", "Entrada PIX", "Pix recebido de Cliente B", "R$ 50,00"),
    row("Saldo do dia 03/11/25", "R$ 510,00"),
    row("04/11", "04/11", "Saída PIX", "Pix enviado para Farmácia", "-R$ 10,00"),
    "-- 1 of 1 --",
    "Informações sujeitas a alteração até o final do dia",
    "Atendimento 24 horas",
  ].join("\n");
}
