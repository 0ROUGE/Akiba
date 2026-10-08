// Kenyan mobile number helpers. The UI shows a fixed "+254" prefix, so the
// editable value everywhere in the app is the *national* part only: the 9
// digits after +254 (e.g. "712345678"). Storage / Daraja formats are derived.

export const KE_DIAL_CODE = "+254";

// Accepts whatever a person might type or paste — "0712 345 678",
// "+254 712 345 678", "254712345678", "712345678" — and returns at most the
// 9 national digits. Never throws on bad input.
export function extractNationalNumber(input) {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.startsWith("254")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 9);
}

// Kenyan mobile numbers are 9 digits after the country code and start with 7
// (07xx) or 1 (01xx). Format check only — it can't tell whether the number is
// actually registered on M-Pesa.
export function isValidKenyanMobile(national) {
  return /^[17]\d{8}$/.test(String(national ?? ""));
}

// "+254712345678" — what we store on the profile / auth metadata.
export function toE164(national) {
  return `${KE_DIAL_CODE}${national}`;
}

// "254712345678" — what Daraja expects.
export function toDaraja(national) {
  return `254${national}`;
}

// "712 345 678" for display.
export function formatNational(national) {
  const n = String(national ?? "");
  return [n.slice(0, 3), n.slice(3, 6), n.slice(6, 9)].filter(Boolean).join(" ");
}
