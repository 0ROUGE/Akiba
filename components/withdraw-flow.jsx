"use client";

import { MpesaFlow } from "@/components/mpesa-flow";

// Same journey as DepositFlow, for withdrawals. Pass `available` (the AKIBA
// balance) to show it and catch over-withdrawals before the server does.
export function WithdrawFlow(props) {
  return <MpesaFlow kind="withdrawal" {...props} />;
}
