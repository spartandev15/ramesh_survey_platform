/**
 * Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, embedded commas
 * and new lines, CRLF or LF, and a leading byte-order mark. Values are
 * returned exactly as written (no trimming or type guessing).
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export function parseCsv(text: string): CsvTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  let i = 0;

  const endValue = () => {
    record.push(value);
    value = "";
  };
  const endRecord = () => {
    endValue();
    // Skip blank lines, which spreadsheets often leave at the end.
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        value += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && value === "") quoted = true;
    else if (ch === ",") endValue();
    else if (ch === "\n") endRecord();
    else if (ch === "\r") {
      if (input[i + 1] !== "\n") endRecord();
    } else value += ch;
    i++;
  }
  if (quoted) throw new CsvError("The file ends inside a quoted value. Check for a missing closing quote.");
  if (value !== "" || record.length > 0) endRecord();

  if (records.length === 0) throw new CsvError("The file is empty.");
  const headers = records[0].map((h) => h.trim());
  if (headers.some((h) => h === "")) throw new CsvError("Every column needs a header name in the first row.");
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new CsvError("Two columns have the same header name.");

  const rows = records.slice(1);
  rows.forEach((row, index) => {
    if (row.length > headers.length && row.slice(headers.length).some((v) => v.trim() !== "")) {
      throw new CsvError(`Row ${index + 1} has more values than there are columns.`);
    }
  });
  return { headers, rows: rows.map((row) => headers.map((_, c) => row[c] ?? "")) };
}
