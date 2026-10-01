/**
 * Extrato de conta do Mercado Pago MASCARADO: titular, nomes, ids de operação e valores inventados
 * (nunca dados reais), mas com as manias do texto que o pdf-parse devolve:
 *  - registro numa linha só, com a data sozinha na linha, ou com a descrição quebrada em várias;
 *  - "R$ -17,00" (sinal depois do R$), milhar com ponto e centavos de rendimento (R$ 0,01);
 *  - um número solto dentro da descrição que NÃO é o id da operação;
 *  - o mesmo id de operação em dois registros de sinais opostos (liberação e cancelamento);
 *  - registro partido pela quebra de página (a primeira linha da descrição fica no fim da página 1);
 *  - "Saldo final" no MEIO do texto (logo depois das linhas da página 1);
 *  - rodapé legal no topo da página 3 (termina com a marca "3/3") e cabeçalho de colunas repetido por página.
 */
export type MpStyle = "single" | "wrapped" | "dateAlone" | "split";

export interface MpRecord {
  /** dd-mm-aaaa */
  date: string;
  style: MpStyle;
  /** Linhas da descrição na ordem em que o texto as devolve (a descrição esperada é o join com espaço). */
  lines: string[];
  opId: string;
  cents: number;
  /** Quebra de página depois deste registro (o "split" já quebra por si). */
  pageBreakAfter?: boolean;
}

export const MP_RECORDS: MpRecord[] = [
  { date: "01-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379376", cents: 3 },
  { date: "01-09-2026", style: "wrapped", lines: ["Pix recebido ANA TESTE", "DA SILVA EXEMPLO"], opId: "175765430545", cents: 120000 },
  {
    date: "01-09-2026", style: "dateAlone",
    lines: ["Pix enviado Carlos", "Ficticio Santos Modelo", "60348001371"], opId: "175798242679", cents: -1700,
  },
  { date: "02-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379377", cents: 1 },
  { date: "02-09-2026", style: "single", lines: ["Pagamento Cartao Exemplo"], opId: "175800000001", cents: -100000 },
  // ordem das linhas "fora de ordem", como o extrator devolve: a descrição é a das linhas, na ordem recebida
  { date: "03-09-2026", style: "wrapped", lines: ["Liberação", "de dinheiro Venda com Pix"], opId: "176000000001", cents: 5000 },
  { date: "03-09-2026", style: "wrapped", lines: ["Cancelamento", "de liberação Venda com Pix"], opId: "176000000001", cents: -5000 },
  { date: "04-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379378", cents: 2 },
  // dois lançamentos idênticos (mesmo id e valor): o fingerprint ganha ordinal
  { date: "05-09-2026", style: "single", lines: ["Tarifa Exemplo"], opId: "176100000002", cents: -990 },
  { date: "05-09-2026", style: "single", lines: ["Tarifa Exemplo"], opId: "176100000002", cents: -990 },
  // partido pela quebra de página: "Reserva por gastos Reserva" fica no fim da página 1
  { date: "06-09-2026", style: "split", lines: ["Reserva por gastos Reserva", "Emergência"], opId: "176088865931", cents: -350 },

  { date: "07-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379379", cents: 1 },
  { date: "07-09-2026", style: "wrapped", lines: ["Pix recebido MARIA EXEMPLO", "TESTES LTDA"], opId: "176200000001", cents: 87650 },
  { date: "08-09-2026", style: "single", lines: ["Transferência enviada Conta Teste"], opId: "176200000002", cents: -40000 },
  {
    date: "08-09-2026", style: "dateAlone",
    lines: ["Pix enviado Padaria", "Ficticia Central", "9876543210"], opId: "176200000003", cents: -1250,
  },
  {
    date: "09-09-2026", style: "wrapped",
    lines: ["Pagamento de conta", "Energia Exemplo", "Unidade 12"], opId: "176200000004", cents: -18990,
  },
  { date: "10-09-2026", style: "single", lines: ["Reserva por gastos Reserva Emergência"], opId: "176200000005", cents: -1500 },
  { date: "10-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379380", cents: 1 },
  { date: "12-09-2026", style: "single", lines: ["Pix recebido Cliente Ficticio"], opId: "176300000001", cents: 100000 },
  { date: "12-09-2026", style: "single", lines: ["Pix enviado Fornecedor Exemplo"], opId: "176300000002", cents: -100000, pageBreakAfter: true },

  { date: "15-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379381", cents: 4 },
  { date: "15-09-2026", style: "wrapped", lines: ["Pix recebido JOAO", "FICTICIO"], opId: "176400000001", cents: 3000 },
  {
    date: "18-09-2026", style: "dateAlone",
    lines: ["Pix enviado Escola", "Modelo Exemplo", "55512345678"], opId: "176400000002", cents: -45000,
  },
  { date: "20-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379382", cents: 2 },
  { date: "22-09-2026", style: "single", lines: ["Compra Debito Exemplo"], opId: "176400000003", cents: -7890 },
  { date: "25-09-2026", style: "wrapped", lines: ["Pix recebido EMPRESA", "EXEMPLO LTDA"], opId: "176400000004", cents: 150000 },
  { date: "28-09-2026", style: "single", lines: ["Rendimentos"], opId: "1749235379383", cents: 3 },
  { date: "30-09-2026", style: "single", lines: ["Pagamento Boleto Exemplo"], opId: "176400000005", cents: -25000 },
];

export const MP_SAMPLE = {
  conta: "12345678901",
  agencia: "1",
  documento: "00000000000",
  rowCount: MP_RECORDS.length,
  initialCents: 150000,
  period: { from: "2026-09-01", to: "2026-09-30" },
  incomesCents: MP_RECORDS.filter((r) => r.cents > 0).reduce((s, r) => s + r.cents, 0),
  outgoingsCents: MP_RECORDS.filter((r) => r.cents < 0).reduce((s, r) => s + r.cents, 0),
  finalCents: 150000 + MP_RECORDS.reduce((s, r) => s + r.cents, 0),
} as const;

/** "R$ 1.200,00" / "R$ -1.000,00" (o sinal vem depois do R$, como no extrato). */
export function mpMoney(cents: number): string {
  const abs = Math.abs(cents);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${cents < 0 ? "-" : ""}${int},${String(abs % 100).padStart(2, "0")}`;
}

const COLUMN_HEADER = "Data Descrição ID da operação Valor Saldo";

export interface MpTextOptions {
  /** Soma ao total de entradas declarado no cabeçalho (centavos). */
  incomesDelta?: number;
  /** Soma ao total de saídas declarado no cabeçalho (centavos). */
  outgoingsDelta?: number;
  /** Soma ao saldo corrente impresso no registro n (1-based; centavos). */
  balanceDelta?: { record: number; cents: number };
  /** Soma ao valor impresso do registro n (1-based) sem mexer nos saldos. */
  valueDelta?: { record: number; cents: number };
  /** Soma ao "Saldo final" declarado. */
  finalDelta?: number;
  /** Troca o rótulo da conta por um número de conta diferente. */
  conta?: string;
}

/** Texto do extrato como o pdf-parse o devolve (3 páginas, "Saldo final" no meio, rodapé legal no topo da página 3). */
export function mercadoPagoSampleText(opts: MpTextOptions = {}): string {
  const out: string[] = [];
  let balance: number = MP_SAMPLE.initialCents;
  const closing = (r: MpRecord, i: number) => {
    balance += r.cents;
    const printedValue = r.cents + (opts.valueDelta?.record === i + 1 ? opts.valueDelta.cents : 0);
    const printedBalance = balance + (opts.balanceDelta?.record === i + 1 ? opts.balanceDelta.cents : 0);
    return `${r.opId} ${mpMoney(printedValue)} ${mpMoney(printedBalance)}`;
  };

  out.push(
    "1/3",
    "EXTRATO DE CONTA",
    "TITULAR FICTICIO DE TESTE",
    `CPF/CNPJ: ${MP_SAMPLE.documento} ${MP_SAMPLE.agencia} ${opts.conta ?? MP_SAMPLE.conta}\tAgência: Conta:`,
    "De 01-09-2026 al 30-09-2026\tPeriodo:",
    `Saldo inicial: ${mpMoney(MP_SAMPLE.initialCents)} Entradas: ${mpMoney(MP_SAMPLE.incomesCents + (opts.incomesDelta ?? 0))}`,
    `Saidas: ${mpMoney(MP_SAMPLE.outgoingsCents + (opts.outgoingsDelta ?? 0))}`,
    "DETALHE DOS MOVIMENTOS",
    COLUMN_HEADER,
  );

  let page = 1;
  let pendingSplit: { r: MpRecord; i: number } | null = null;
  MP_RECORDS.forEach((r, i) => {
    switch (r.style) {
      case "single":
        out.push(`${r.date} ${r.lines[0]} ${closing(r, i)}`);
        break;
      case "wrapped":
        out.push(`${r.date} ${r.lines[0]}`, ...r.lines.slice(1, -1), `${r.lines[r.lines.length - 1]} ${closing(r, i)}`);
        break;
      case "dateAlone":
        out.push(r.date, ...r.lines, closing(r, i));
        break;
      case "split":
        // a primeira linha da descrição fica no fim desta página; a data, o resto e o fechamento vão para a seguinte
        out.push(r.lines[0]);
        pendingSplit = { r, i };
        break;
    }
    if (r.style === "split" || r.pageBreakAfter) {
      if (page === 1) out.push(`Saldo final: ${mpMoney(MP_SAMPLE.finalCents + (opts.finalDelta ?? 0))}`);
      out.push("", `-- ${page} of 3 --`, "");
      page += 1;
      if (page === 2) {
        out.push(`${page}/3`, COLUMN_HEADER);
        const s = pendingSplit as { r: MpRecord; i: number } | null;
        if (s) out.push(`${s.r.date} ${s.r.lines.slice(1).join(" ")} ${closing(s.r, s.i)}`);
      } else {
        // o rodapé legal substitui a marca "3/3" isolada: termina com ela colada na última linha
        out.push(
          "Data de geração: 01-10-2026",
          "Texto de rodapé fictício para o teste do parser, que ocupa várias linhas. Ligue 0800 000 0000",
          "ou 0300 000 0000. Razão Social Exemplo SA. CNPJ n.º 00.000.000/0000-00. Endereço: Rua Exemplo, nº 1, Bairro,",
          "Cidade Exemplo UF - CEP 00000-",
          "000. Mais informações em https://exemplo.test/ajuda 3/3",
          COLUMN_HEADER,
        );
      }
    }
  });
  out.push("", `-- ${page} of 3 --`, "");
  return out.join("\n");
}

/** Descrição esperada de cada registro (linhas na ordem do texto, unidas por espaço). */
export const MP_DESCRIPTIONS: string[] = MP_RECORDS.map((r) => r.lines.join(" "));
