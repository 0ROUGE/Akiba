// Dependency-free PDF receipt generator (standard Helvetica fonts, one A4 page).
//
// Why hand-written instead of a library: nothing extra to install or bundle,
// nothing that can break the Vercel build, and a receipt only needs text,
// rectangles and a few shapes. Runs in the Node.js runtime (uses Buffer).
//
// Look: dark AKIBA header + green accents, white body, green amount box —
// matching the Safaricom / ZiiDi receipts the product is modelled on.

import {
  RECEIPT_TYPES,
  cleanDescription,
  formatKesAmount,
  formatPhone,
  formatReceiptDate,
  receiptRef,
} from "./receipt-format.js";

export { cleanDescription, formatKesAmount, formatPhone, formatReceiptDate };

const W = 595.28; // A4 in points
const H = 841.89;

const GREEN = "#4CAF50";
const GREEN_DARK = "#2E7D32";
const GREEN_LIGHT = "#7ED58F";
const INK = "#1B1B1B";
const GREY = "#6B7280";
const RULE = "#D9DEE3";
const HEADER = "#121212";

// ---- Helvetica metrics (units per 1000 em), ASCII 32..126 ----
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

export function textWidth(str, size, bold = false) {
  const table = bold ? HELV_BOLD : HELV;
  let w = 0;
  for (const ch of String(str)) {
    const code = ch.charCodeAt(0);
    w += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (w * size) / 1000;
}

// Standard PDF fonts use WinAnsi. Map the few typographic characters that show
// up in names/descriptions and drop anything we can't draw rather than corrupt the file.
export function toWinAnsi(input) {
  return String(input ?? "")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, "?");
}

const pdfEscape = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (n) => (Math.round(n * 100) / 100).toString();

function rgb(hex) {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => num(parseInt(v.slice(i, i + 2), 16) / 255)).join(" ");
}

// Tiny drawing DSL. All y values are measured from the TOP of the page.
class Canvas {
  constructor() {
    this.ops = [];
  }
  rect(x, top, w, h, fill) {
    this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(H - top - h)} ${num(w)} ${num(h)} re f`);
  }
  roundedRect(x, top, w, h, r, fill) {
    const k = 0.5523 * r;
    const y = H - top - h;
    const x2 = x + w;
    const y2 = y + h;
    this.ops.push(
      `${rgb(fill)} rg ${num(x + r)} ${num(y)} m ${num(x2 - r)} ${num(y)} l ` +
        `${num(x2 - r + k)} ${num(y)} ${num(x2)} ${num(y + r - k)} ${num(x2)} ${num(y + r)} c ` +
        `${num(x2)} ${num(y2 - r)} l ${num(x2)} ${num(y2 - r + k)} ${num(x2 - r + k)} ${num(y2)} ${num(x2 - r)} ${num(y2)} c ` +
        `${num(x + r)} ${num(y2)} l ${num(x + r - k)} ${num(y2)} ${num(x)} ${num(y2 - r + k)} ${num(x)} ${num(y2 - r)} c ` +
        `${num(x)} ${num(y + r)} l ${num(x)} ${num(y + r - k)} ${num(x + r - k)} ${num(y)} ${num(x + r)} ${num(y)} c f`
    );
  }
  poly(points, fill) {
    const [first, ...rest] = points;
    this.ops.push(
      `${rgb(fill)} rg ${num(first[0])} ${num(H - first[1])} m ` +
        rest.map(([px, py]) => `${num(px)} ${num(H - py)} l`).join(" ") +
        " f"
    );
  }
  line(x1, top1, x2, top2, width, color) {
    this.ops.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(H - top1)} m ${num(x2)} ${num(H - top2)} l S`);
  }
  // baseline measured from the top of the page
  text(str, x, baseline, { size = 11, bold = false, color = INK, align = "left" } = {}) {
    const s = toWinAnsi(str);
    let px = x;
    if (align === "center") px = x - textWidth(s, size, bold) / 2;
    if (align === "right") px = x - textWidth(s, size, bold);
    this.ops.push(
      `BT ${rgb(color)} rg /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(px)} ${num(H - baseline)} Td (${pdfEscape(s)}) Tj ET`
    );
  }
  toString() {
    return this.ops.join("\n");
  }
}

export function wrapText(str, maxWidth, size, bold = false) {
  const words = toWinAnsi(str).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    // hard-split a single word that is wider than the column (e.g. a long reference)
    let w = word;
    while (textWidth(w, size, bold) > maxWidth && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > maxWidth) cut -= 1;
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const candidate = line ? `${line} ${w}` : w;
    if (textWidth(candidate, size, bold) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function receiptFilename(tx) {
  return `akiba-receipt-${receiptRef(tx.id)}.pdf`;
}

// ---- the receipt ----
export function buildReceiptPdf({ tx, profile, generatedAt = new Date() }) {
  const kind = RECEIPT_TYPES[tx.type] ?? RECEIPT_TYPES.spend;
  const c = new Canvas();
  const ref = receiptRef(tx.id);
  const firstName = toWinAnsi(profile?.full_name ?? "").trim().split(" ")[0];
  const phone = formatPhone(profile?.phone);

  // Header band: AKIBA at the very top
  c.rect(0, 0, W, 112, HEADER);
  c.text("AKIBA", 42, 66, { size: 38, bold: true, color: "#FFFFFF" });
  c.text("Save with intention", 44, 88, { size: 11, color: GREEN_LIGHT });
  c.text("TRANSACTION RECEIPT", W - 42, 66, { size: 11, bold: true, color: "#FFFFFF", align: "right" });
  c.text(`Ref ${ref}`, W - 42, 84, { size: 10, color: "#9CA3AF", align: "right" });
  // paper plane (the Safaricom receipt's motif), drawn as two folded wings
  c.poly([[283, 70], [355, 26], [321, 84]], GREEN_LIGHT);
  c.poly([[355, 26], [321, 84], [315, 58]], GREEN);
  c.rect(0, 112, W, 7, GREEN);

  // Greeting
  c.text(firstName ? `Hi ${firstName.toUpperCase()},` : "Hello,", 42, 172, { size: 28, bold: true, color: GREEN_DARK });
  c.text(kind.success, 42, 198, { size: 14, bold: true, color: INK });
  c.text("Thank you for saving with AKIBA.", 42, 218, { size: 12, color: GREY });

  // Amount box (like "Total Amount Paid" on the Safaricom receipt)
  const boxTop = 250;
  c.roundedRect(42, boxTop, 262, 138, 10, GREEN);
  c.text(kind.total, 62, boxTop + 36, { size: 13, bold: true, color: "#FFFFFF" });
  c.text(formatKesAmount(tx.amount), 62, boxTop + 78, { size: 28, bold: true, color: "#FFFFFF" });
  c.line(62, boxTop + 92, 284, boxTop + 92, 1, "#FFFFFF");
  c.text(phone ? `Phone Number: ${phone}` : "Phone number on file", 62, boxTop + 116, { size: 11, color: "#FFFFFF" });

  // Details column
  const colX = 330;
  const colW = W - 42 - colX;
  let y = boxTop + 20;
  const row = (label, value) => {
    if (!value) return;
    const labelText = `${label}: `;
    const labelW = textWidth(labelText, 11, true);
    c.text(labelText, colX, y, { size: 11, bold: true });
    const lines = wrapText(value, colW - labelW, 11);
    c.text(lines[0], colX + labelW, y, { size: 11 });
    for (const extra of lines.slice(1)) {
      y += 15;
      c.text(extra, colX + labelW, y, { size: 11 });
    }
    y += 26;
  };
  row("Date", formatReceiptDate(tx.created_at));
  row("Type", kind.label);
  row("Transaction No", tx.mpesa_receipt_number || ref);
  row("Status", "Confirmed");
  row("AKIBA Ref", ref);
  row("AKIBA fee", "KES 0.00");

  // Description / note
  let noteTop = Math.max(boxTop + 138, y) + 26;
  c.line(42, noteTop, W - 42, noteTop, 1, RULE);
  noteTop += 28;
  const details = cleanDescription(tx.description);
  if (details) {
    c.text("Details", 42, noteTop, { size: 11, bold: true, color: GREEN_DARK });
    for (const line of wrapText(details, W - 84, 11)) {
      noteTop += 16;
      c.text(line, 42, noteTop, { size: 11, color: INK });
    }
    noteTop += 26;
  }
  if (kind.note) {
    for (const line of wrapText(kind.note, W - 84, 11)) {
      c.text(line, 42, noteTop, { size: 11, color: GREY });
      noteTop += 16;
    }
  }

  // Footer
  c.text(
    "This receipt is AKIBA's record of a confirmed transaction. It is not an official M-Pesa statement.",
    W / 2,
    H - 92,
    { size: 9, color: GREY, align: "center" }
  );
  c.text(`Generated ${formatReceiptDate(generatedAt.toISOString())} (EAT)`, W / 2, H - 78, {
    size: 9,
    color: GREY,
    align: "center",
  });
  c.rect(0, H - 52, W, 52, GREEN_DARK);
  c.rect(0, H - 52, W, 4, GREEN);
  c.text("AKIBA", W / 2 - 4, H - 22, { size: 16, bold: true, color: "#FFFFFF", align: "right" });
  c.text("  |  Save with intention", W / 2 - 4, H - 22, { size: 12, color: "#E8F5E9" });

  return assemblePdf(c.toString(), `AKIBA receipt ${ref}`, generatedAt);
}

// ---- PDF container ----
function assemblePdf(content, title, createdAt) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = createdAt;
  const created = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title (${pdfEscape(toWinAnsi(title))}) /Producer (AKIBA) /Creator (AKIBA) /CreationDate (${created}) >>`,
  ];

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  // every character is <= 0xFF by construction, so latin1 == 1 byte per char and offsets stay exact
  return Buffer.from(out, "latin1");
}
