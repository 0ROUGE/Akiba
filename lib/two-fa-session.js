import { signToken } from "./signed-cookie.js";

// The "this session has passed 2FA" cookie. Signed (see signed-cookie.js) so it can't
// be forged from a password-only session.
export const TWO_FA_COOKIE = "akiba_2fa_ok";
export const TWO_FA_MAX_AGE_S = 60 * 60 * 12; // 12 hours

export async function issueTwoFa(response, userId) {
  const token = await signToken("2fa", userId, TWO_FA_MAX_AGE_S * 1000);
  response.cookies.set(TWO_FA_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TWO_FA_MAX_AGE_S,
  });
}
