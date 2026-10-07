// Pure decision logic for the "left the site for over a minute" auto-logout.
// Kept separate from the React component so it can be unit-tested.

export const AWAY_LIMIT_MS = 60 * 1000;

// lastSeen   – ms timestamp of the last moment the app was visible (or null)
// signedInAt – ms timestamp of the current sign-in (or null). A lastSeen that
//              predates this sign-in belongs to an older session and is ignored,
//              so logging back in never bounces you straight out again.
export function shouldLogoutForAway({ now, lastSeen, signedInAt, limitMs = AWAY_LIMIT_MS }) {
  if (!Number.isFinite(now) || !Number.isFinite(lastSeen) || lastSeen <= 0) return false;
  if (Number.isFinite(signedInAt) && lastSeen < signedInAt) return false;
  if (lastSeen > now) return false; // clock went backwards — don't punish the user
  return now - lastSeen > limitMs;
}
