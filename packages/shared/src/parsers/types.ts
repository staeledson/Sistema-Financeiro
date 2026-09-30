import type { Institution } from "../enums";

export type StatementKind = "statement" | "card_invoice";
export type StatementFormat = "ofx" | "pdf_statement";

export interface DetectResult {
  institution: Institution;
  kind: StatementKind;
  format: StatementFormat;
  /** Número da conta (ou final do cartão) como aparece no arquivo; usado para reconhecer a conta cadastrada. */
  accountRef: string | null;
  /** 0–1. Abaixo de 0,5 o arquivo é tratado como não reconhecido. */
  confidence: number;
}

export interface ParsedRow {
  type: "income" | "expense";
  /** Sempre positivo; o sentido está em `type`. */
  amountCents: number;
  /** Data do lançamento, YYYY-MM-DD. */
  date: string;
  /** Data contábil, YYYY-MM-DD (quando o banco informa). */
  postedDate: string | null;
  description: string | null;
  fingerprint: string;
}

export interface BalancePoint {
  dateISO: string;
  balanceCents: number;
  /**
   * Saldo corrente (momento da exportação): inclui lançamentos já feitos com data contábil futura;
   * a conferência soma as linhas sem limite superior de data.
   */
  current?: boolean;
}

export interface ParsedStatement {
  rows: ParsedRow[];
  balances: BalancePoint[];
  accountRef: string | null;
  period: { from: string; to: string } | null;
}

export interface StatementParser {
  id: string;
  detect(text: string): DetectResult | null;
  parse(text: string, ctx: { accountId: string }): ParsedStatement;
}

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementParseError";
  }
}
