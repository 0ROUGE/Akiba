"use client";

import { MpesaFlow } from "@/components/mpesa-flow";

// Amount -> "Check your phone" spinner -> automatic success screen with receipt
// download/share. Survives a refresh. See components/mpesa-flow.jsx.
export function DepositFlow(props) {
  return <MpesaFlow kind="deposit" {...props} />;
}
