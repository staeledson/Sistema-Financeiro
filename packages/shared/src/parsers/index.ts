import { c6CardInvoiceParser } from "./c6-card-invoice";
import { c6StatementParser } from "./c6-statement";
import { ofxStatementParser } from "./ofx-statement";
import type { DetectResult, StatementParser } from "./types";

export * from "./types";
export * from "./text";
export * from "./balance";
export * from "./csv-lite";
export * from "./bank-category";
export { c6StatementParser, ofxStatementParser, c6CardInvoiceParser };

export const STATEMENT_PARSERS: StatementParser[] = [c6StatementParser, ofxStatementParser, c6CardInvoiceParser];

/** Parser de maior confiança para o texto; confiança abaixo de 0,5 conta como não reconhecido. */
export function detectStatement(text: string): { parser: StatementParser; detected: DetectResult } | null {
  let best: { parser: StatementParser; detected: DetectResult } | null = null;
  for (const parser of STATEMENT_PARSERS) {
    const detected = parser.detect(text);
    if (detected && (!best || detected.confidence > best.detected.confidence)) best = { parser, detected };
  }
  return best && best.detected.confidence >= 0.5 ? best : null;
}
