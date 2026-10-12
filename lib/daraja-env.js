// Which Daraja environment we're in. Sandbox is the default; production must be
// switched on explicitly with DARAJA_ENV=production once you have a real paybill.

export function isProduction() {
  return process.env.DARAJA_ENV === "production";
}

// The Daraja sandbox cannot pay out to a real phone (B2C only works for
// Safaricom's own test number, and no real money moves in sandbox anyway). So in
// SANDBOX ONLY, withdrawals are simulated by AKIBA so the whole flow can be used
// and tested. Hard-disabled in production. Set SANDBOX_SIMULATE_PAYOUTS=false to
// try Safaricom's real sandbox B2C instead.
export function sandboxSimulationEnabled() {
  return !isProduction() && process.env.SANDBOX_SIMULATE_PAYOUTS !== "false";
}
