// One place that decides what a Safaricom STK Push query result means, shared by the
// on-screen status route (/api/mpesa/stk-status) and the nightly reconcile sweep so
// the two can never disagree.
//
// Daraja ResultCodes for an STK query:
//   "0"            paid
//   "500.001.1001" request still being processed (HTTP 500 while the user hasn't answered)
//   "1032"         cancelled by the user on the phone
//   "1037"         timed out - the prompt was never answered (FINAL, not "still waiting")
//   "1"            insufficient M-Pesa balance
//   "2001"         wrong PIN
//   anything else  a final failure carrying its own ResultDesc

// An STK prompt is only live for about a minute or two. Past this age, "1037" is final.
export const STK_PROMPT_LIVE_MS = 120_000;
// A pending deposit that never got a Safaricom reference died between "row created" and
// "prompt sent" (e.g. the function was killed). Nothing can ever confirm it.
export const UNSENT_ABANDON_MS = 180_000;

export const TIMEOUT_DESCRIPTION = "Request timed out - the M-Pesa prompt wasn't approved in time.";
export const UNSENT_DESCRIPTION = "No response from M-Pesa - the request was never sent.";

// -> { action: "confirm" } | { action: "pending" } | { action: "fail", description, notify }
export function classifyStkResult(resultCode, resultDesc, ageMs) {
  // A reply with no result code is a malformed/partial response, NOT an answer. Leave the
  // row alone and ask again later - failing it could wrongly void a payment that went through.
  if (resultCode === undefined || resultCode === null || String(resultCode).trim() === "") {
    return { action: "pending" };
  }
  const code = String(resultCode);
  if (code === "0") return { action: "confirm" };
  if (code === "500.001.1001") return { action: "pending" };
  if (code === "1037") {
    return Number(ageMs) >= STK_PROMPT_LIVE_MS
      ? { action: "fail", description: TIMEOUT_DESCRIPTION, notify: false }
      : { action: "pending" };
  }
  if (code === "1032") return { action: "fail", description: "Cancelled on phone", notify: false };
  if (code === "1") return { action: "fail", description: "The balance is insufficient for the transaction.", notify: true };
  if (code === "2001") return { action: "fail", description: "The M-Pesa PIN entered was wrong.", notify: true };
  const desc = typeof resultDesc === "string" && resultDesc.trim() ? resultDesc.trim().slice(0, 200) : "Deposit failed";
  return { action: "fail", description: desc, notify: true };
}

// A deposit with no Safaricom reference (not "ws_CO_...") that is old enough that it can
// only be a dead request.
export function isAbandonedUnsent(receiptNumber, ageMs, thresholdMs = UNSENT_ABANDON_MS) {
  const sent = typeof receiptNumber === "string" && receiptNumber.startsWith("ws_CO_");
  return !sent && Number(ageMs) >= thresholdMs;
}
