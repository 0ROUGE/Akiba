"use client";

import { useState } from "react";
import { Share2, Copy, Printer, Check, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadReceiptImage, shareReceipt } from "@/lib/receipt-image";

// `receipt` (from buildReceipt) enables the image download and image sharing.
// `compact` shows just Download + Share (used on the deposit success screen).
export function ReceiptActions({ text, pdfHref, receipt, compact = false }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(null); // "download" | "share" | null
  const [note, setNote] = useState("");
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareText = receipt?.text ?? text;

  async function handleDownload() {
    setBusy("download");
    setNote("");
    try {
      await downloadReceiptImage(receipt);
    } catch {
      setNote("Couldn't create the receipt image. Try Print instead.");
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    setBusy("share");
    setNote("");
    try {
      if (receipt) await shareReceipt(receipt);
      else await navigator.share({ title: "AKIBA receipt", text: shareText });
    } catch (err) {
      if (err?.name !== "AbortError") setNote("Couldn't open the share sheet.");
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  const showCopy = !compact || !canShare;

  return (
    <div className="print:hidden">
      <div className="flex flex-wrap gap-2">
        {receipt && (
          <Button onClick={handleDownload} disabled={busy !== null} className="gap-1.5">
            {busy === "download" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Download receipt
          </Button>
        )}
        {pdfHref && (
          <a
            href={pdfHref}
            download
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download size={15} /> Download PDF
          </a>
        )}
        {canShare && (
          <Button
            variant={receipt || pdfHref ? "outline" : "default"}
            onClick={handleShare}
            disabled={busy !== null}
            className="gap-1.5"
          >
            {busy === "share" ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />} Share
          </Button>
        )}
        {showCopy && (
          <Button variant="outline" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
          </Button>
        )}
        {!compact && (
          <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
            <Printer size={15} /> Print
          </Button>
        )}
      </div>
      {note && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {note}
        </p>
      )}
    </div>
  );
}
