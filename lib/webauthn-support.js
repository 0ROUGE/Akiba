// Feature-detects whether this device can actually do biometric/platform
// WebAuthn (Face ID, Touch ID, Windows Hello, Android fingerprint) — as
// opposed to just supporting WebAuthn via an external security key, or not
// supporting it at all (older Safari, some in-app browsers).
export async function supportsPlatformPasskey() {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
