// Feature-detects whether this device can actually do biometric/platform
// WebAuthn (Face ID, Touch ID, Windows Hello, Android fingerprint) — as
// opposed to just supporting WebAuthn via an external security key, or not
// supporting it at all (older Safari, some in-app browsers).
// Supabase's passkey errors carry a `.code` (WebAuthnError) or `.name`
// (plain DOMException / AuthError) worth distinguishing — most failures
// people hit early on are a Relying Party ID/origin mismatch (the Supabase
// Dashboard config not matching the actual domain yet), which otherwise
// just looks like a silent, unexplained failure.
export function describePasskeyError(error, { mode = "signin" } = {}) {
  if (!error) return null;
  const code = error.code || error.name || "";
  const message = (error.message || "").toLowerCase();

  if (code === "ERROR_INVALID_RP_ID" || code === "ERROR_INVALID_DOMAIN" || message.includes("rp")) {
    return "Biometric sign-in isn't configured for this domain yet.";
  }
  if (
    code === "NotAllowedError" ||
    code === "ERROR_CEREMONY_ABORTED" ||
    code === "AbortError" ||
    message.includes("cancel") ||
    message.includes("not allowed")
  ) {
    return null; // user backed out of the OS prompt — not an error worth showing
  }
  if (code === "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT") {
    return "This device doesn't support passwordless sign-in.";
  }
  if (message.includes("does not support webauthn")) {
    return "This browser doesn't support biometric sign-in.";
  }
  return mode === "register"
    ? "Couldn't register this device. Make sure a screen lock or biometric is set up on it."
    : "Couldn't sign in with that passkey. Use your password instead.";
}

export async function supportsPlatformPasskey() {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
