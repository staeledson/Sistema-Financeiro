export interface CsvLine {
  /** Número da linha no arquivo (1 = primeira), contando as linhas vazias descartadas. */
  line: number;
  cells: string[];
}

/** CSV simples: BOM removido, CRLF/LF, aspas com `""`, linhas vazias descartadas. Mantém o número da linha de origem. */
export function readCsvLines(text: string, delimiter = ";"): CsvLine[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: CsvLine[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let fieldWasQuoted = false;
  let line = 1;
  let startLine = 1;

  const endRecord = () => {
    cells.push(field);
    const empty = cells.length === 1 && cells[0] === "" && !fieldWasQuoted;
    if (!empty) out.push({ line: startLine, cells });
    cells = [];
    field = "";
    fieldWasQuoted = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
      fieldWasQuoted = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = "";
      fieldWasQuoted = false;
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRecord();
      line++;
      startLine = line;
    } else if (ch === "\n") {
      endRecord();
      line++;
      startLine = line;
    } else field += ch;
  }
  if (field !== "" || cells.length > 0 || fieldWasQuoted) endRecord();
  return out;
}

export function readCsv(text: string, delimiter = ";"): string[][] {
  return readCsvLines(text, delimiter).map((l) => l.cells);
}
