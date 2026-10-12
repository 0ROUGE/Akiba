"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  RECEIPT_TYPES,
  cleanDescription,
  formatKesAmount,
  formatPhone,
  formatReceiptDate,
  receiptRef,
  shouldAnnounceTransaction,
} from "@/lib/receipt-format";

const SEEN_KEY = "akiba_seen_tx";

function readSeen() {
  try {
    const list = JSON.parse(window.localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function markSeen(id) {
  try {
    const list = [id, ...readSeen().filter((x) => x !== id)].slice(0, 50);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked — worst case the screen could show twice */
  }
}

// Pops a "Your transaction was successful" screen the moment a deposit,
// withdrawal or goal allocation is CONFIRMED — wherever in the app the person
// happens to be (a deposit confirms when Safaricom calls back, which can be
// while they're on any page). Nothing is shown for pending or failed ones.
export function TransactionSuccess() {
  const [queue, setQueue] = useState([]);
  const [profile, setProfile] = useState(null);
  const [copied, setCopied] = useState(false);
  const seenRef = useRef(new Set());

  useEffect(() => {
    const supabase = createClient();
    let channel;
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data } = await supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle();
      if (!cancelled) setProfile(data ?? null);

      const onChange = (payload) => {
        const row = payload.new;
        const seen = [...readSeen(), ...seenRef.current];
        if (!shouldAnnounceTransaction(row, seen)) return;
        seenRef.current.add(row.id);
        markSeen(row.id);
        setQueue((q) => [...q, row]);
      };

      channel = supabase
        .channel(`tx-success-${user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "ledger_transactions", filter: `user_id=eq.${user.id}` },
          onChange
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const tx = queue[0];

  function close() {
    setCopied(false);
    setQueue((q) => q.slice(1));
  }

  useEffect(() => {
    if (!tx) return;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tx]);

  async function copyId(id) {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  const kind = tx ? RECEIPT_TYPES[tx.type] ?? RECEIPT_TYPES.spend : null;
  const phone = formatPhone(profile?.phone);
  const txId = tx ? tx.mpesa_receipt_number || receiptRef(tx.id) : "";
  const detail = tx ? cleanDescription(tx.description) : "";

  return (
    <AnimatePresence>
      {tx && (
        <motion.div
          key={tx.id}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4 print:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Transaction successful"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="relative max-h-[95vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-[#1c1c1e] px-6 pb-8 pt-12 text-white sm:rounded-3xl"
          >
            {/* green accent line, like the reference receipt */}
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-3xl bg-gradient-to-r from-[#2E7D32] via-[#4CAF50] to-[#7ED58F]" />

            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.12, type: "spring", stiffness: 260, damping: 16 }}
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#27302a] ring-2 ring-[#4CAF50]"
            >
              <Check size={38} strokeWidth={3} className="text-[#4CAF50]" />
            </motion.div>

            <h2 className="mt-6 text-center font-display text-2xl font-medium leading-snug">
              Your transaction was successful
            </h2>
            <p className="mt-3 text-center text-sm text-white/55">{formatReceiptDate(tx.created_at)}</p>

            <p className="mt-6 text-center font-display text-4xl font-semibold tabular-nums">
              {formatKesAmount(tx.amount)}
            </p>
            <p className="mt-2 text-center text-xs text-white/55">
              <span className="font-medium text-white/75">AKIBA fee:</span> KES 0.00
            </p>

            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => copyId(txId)}
                className="flex items-center gap-1.5 text-[#4CAF50] hover:text-[#7ED58F]"
                aria-label="Copy transaction ID"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <span className="font-semibold text-[#4CAF50]">ID: {txId}</span>
            </div>

            <div className="mt-6 rounded-2xl bg-[#2c2c2e] p-4 text-sm">
              <p className="text-right text-xs text-white/55">{kind.partyLabel}</p>
              {tx.type === "allocation" ? (
                <p className="mt-1 text-right font-medium">{detail || "A savings goal"}</p>
              ) : (
                <>
                  {profile?.full_name && (
                    <p className="mt-1 text-right font-medium uppercase">{profile.full_name}</p>
                  )}
                  {phone && <p className="text-right text-white/80">Phone number: {phone}</p>}
                </>
              )}
              <p className="mt-2 text-right text-xs text-white/45">{kind.label}</p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 text-center text-xs">
              <a
                href={`/api/receipts/${tx.id}/pdf`}
                download
                className="flex flex-col items-center gap-2 rounded-2xl bg-[#2c2c2e] px-3 py-3 text-white/85 transition-colors hover:bg-[#363638]"
              >
                <Download size={22} className="text-[#4CAF50]" />
                Download PDF receipt
              </a>
              <Link
                href={`/dashboard/receipt/${tx.id}`}
                onClick={close}
                className="flex flex-col items-center gap-2 rounded-2xl bg-[#2c2c2e] px-3 py-3 text-white/85 transition-colors hover:bg-[#363638]"
              >
                <FileText size={22} className="text-[#4CAF50]" />
                View receipt
              </Link>
            </div>

            <button
              type="button"
              autoFocus
              onClick={close}
              className="mt-6 h-12 w-full rounded-2xl bg-[#4CAF50] text-base font-medium text-[#0b140c] transition-colors hover:bg-[#5DBE62]"
            >
              Done
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
