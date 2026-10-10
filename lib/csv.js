// CSV building for statement export.

// Cells that start with = + - @ (or tab / CR) are treated as formulas by Excel
// and Google Sheets. Free text (e.g. a transaction description) could be abused
// to run one, so text cells get a leading apostrophe. Real numbers are exempt,
// otherwise every negative amount would be corrupted.
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  let s;
  if (typeof value === "number") {
    s = Number.isFinite(value) ? String(value) : "";
  } else {
    s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// columns: [{ header: "Date", value: (row) => ... }]
export function toCsv(rows, columns) {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows ?? []) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}
