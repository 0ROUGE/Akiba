// Client-only: draws a receipt to a PNG with the Canvas API (no dependencies),
// so it can be saved to the phone gallery or shared straight into WhatsApp.

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function fit(ctx, text, maxWidth) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

export function receiptToBlob(receipt) {
  const W = 800;
  const scale = 2;
  const pad = 56;
  const rowH = 68;
  const headH = 330;
  const footH = 150;
  const H = headH + receipt.rows.length * rowH + footH;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas unavailable"));
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Brand band
  ctx.fillStyle = "#0b2a6f";
  ctx.fillRect(0, 0, W, 120);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText("AKIBA", pad, 60);
  ctx.textAlign = "right";
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText("Transaction receipt", W - pad, 60);

  // Confirmed badge
  ctx.fillStyle = "#16a34a";
  ctx.beginPath();
  ctx.arc(pad + 28, 190, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pad + 16, 190);
  ctx.lineTo(pad + 25, 200);
  ctx.lineTo(pad + 42, 180);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#475569";
  ctx.font = `500 24px ${FONT}`;
  ctx.fillText(`${receipt.label} confirmed`, pad + 80, 190);
  ctx.fillStyle = "#0f172a";
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(receipt.amount, pad, 265);

  // Detail rows
  let y = headH;
  for (const [k, v] of receipt.rows) {
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(W - pad, y);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#64748b";
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(k, pad, y + rowH / 2);

    ctx.textAlign = "right";
    ctx.fillStyle = "#0f172a";
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(fit(ctx, v, W - pad * 2 - 250), W - pad, y + rowH / 2);
    y += rowH;
  }
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(W - pad, y);
  ctx.stroke();

  // Footer
  ctx.textAlign = "left";
  ctx.fillStyle = "#94a3b8";
  ctx.font = `400 19px ${FONT}`;
  ctx.fillText("AKIBA's record of a confirmed transaction.", pad, y + 50);
  ctx.fillText("Not an official M-Pesa statement.", pad, y + 80);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't render receipt"))), "image/png");
  });
}

export async function downloadReceiptImage(receipt) {
  const blob = await receiptToBlob(receipt);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = receipt.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Shares the receipt as an image where the device allows files, else as text.
// Throws AbortError if the user dismisses the share sheet (callers ignore it).
export async function shareReceipt(receipt) {
  const blob = await receiptToBlob(receipt);
  const file = new File([blob], receipt.filename, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: "AKIBA receipt", text: receipt.text });
    return "image";
  }
  if (typeof navigator.share === "function") {
    await navigator.share({ title: "AKIBA receipt", text: receipt.text });
    return "text";
  }
  return "unsupported";
}
