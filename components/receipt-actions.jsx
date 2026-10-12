"use client";

import { useState } from "react";
import { Share2, Copy, Printer, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReceiptActions({ text, pdfHref }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleShare() {
    try {
      await navigator.share({ title: "AKIBA receipt", text });
    } catch {
      /* dismissed the share sheet — nothing to do */
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
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
        <Button variant={pdfHref ? "outline" : "default"} onClick={handleShare} className="gap-1.5">
          <Share2 size={15} /> Share
        </Button>
      )}
      <Button variant="outline" onClick={handleCopy} className="gap-1.5">
        {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
      </Button>
      <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
        <Printer size={15} /> Print
      </Button>
    </div>
  );
}
