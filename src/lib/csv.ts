/**
 * A CSV cell that a spreadsheet will show as text, never run as a formula
 * (AT-40): values starting with = + - @ or a control character get a leading
 * apostrophe, and every cell is quoted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // Byte-order mark so spreadsheet apps read UTF-8 correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
