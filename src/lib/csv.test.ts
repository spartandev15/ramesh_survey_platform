import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("CSV export safety (AT-40)", () => {
  it("neutralizes formula-like cells and quotes everything", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    for (const v of ["+1", "-2", "@SUM(A1)", "\tcmd"]) expect(csvCell(v).startsWith(`"'`)).toBe(true);
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(3.5)).toBe('"3.5"');
    // A negative score is a number, not a formula: spreadsheets must read it as -20.
    expect(csvCell(-20)).toBe('"-20"');
  });

  it("writes a UTF-8 CSV with CRLF rows", () => {
    expect(toCsv(["a", "b"], [["1", "x,y"]])).toBe('﻿"a","b"\r\n"1","x,y"\r\n');
  });
});
