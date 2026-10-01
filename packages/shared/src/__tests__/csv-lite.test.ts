import { describe, it, expect } from "vitest";
import { readCsv } from "../parsers/csv-lite";

describe("readCsv", () => {
  it("remove o BOM e aceita CRLF", () => {
    expect(readCsv("﻿a;b\r\nc;d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("aceita LF e descarta linha vazia final e do meio", () => {
    expect(readCsv("a;b\n\nc;d\n\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("campo entre aspas pode ter o separador e aspas duplas escapadas", () => {
    expect(readCsv('x;"a;b";"diz ""oi"""\n')).toEqual([["x", "a;b", 'diz "oi"']]);
  });

  it("preserva campo vazio no meio", () => {
    expect(readCsv("a;;c")).toEqual([["a", "", "c"]]);
  });

  it("aceita outro separador", () => {
    expect(readCsv("a,b\n1,2", ",")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
