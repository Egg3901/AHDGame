/**
 * Silent session refresh extends cookie expiry only. It keeps the original
 * verified sign-in iat and is not a reauthentication.
 */
import { jwtVerify, SignJWT } from "jose";

export type SilentRefreshClaims = {
  userId: string;
  email: string;
  username: string;
  role: string;
  isAdmin: boolean;
};

export type SilentRefreshResult =
  { ok: true; token: string; iat: number } | { ok: false; reason: "not_due" | "invalid_iat" };

/** Match the existing client-nav window: refresh when fewer than 24h remain. */
const REFRESH_WITHIN_SECONDS = 60 * 60 * 24;

function isUsableIssuedAt(iat: unknown, nowSec: number): iat is number {
  return typeof iat === "number" && Number.isSafeInteger(iat) && iat >= 0 && iat <= nowSec;
}

function readVerifiedSession(
  payload: unknown
): { userId: string; iat: unknown; exp: unknown } | null {
  if (!payload || typeof payload !== "object") return null;
  const { userId, iat, exp } = payload as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0) return null;
  return { userId, iat, exp };
}

/**
 * Re-sign a still-valid session JWT, copying the verified iat. Missing,
 * non-integer, or future iat fails closed (no new cookie).
 */
export async function refreshSessionPreservingIssuedAt(
  token: string,
  claims: SilentRefreshClaims,
  secret: Uint8Array,
  nowMs: number = Date.now()
): Promise<SilentRefreshResult> {
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "invalid_iat" };
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(nowSec)) return { ok: false, reason: "invalid_iat" };

  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] }));
  } catch {
    return { ok: false, reason: "invalid_iat" };
  }

  const session = readVerifiedSession(payload);
  if (!session || session.userId !== claims.userId) {
    return { ok: false, reason: "invalid_iat" };
  }

  if (!isUsableIssuedAt(session.iat, nowSec)) {
    return { ok: false, reason: "invalid_iat" };
  }

  const { exp } = session;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp - nowSec >= REFRESH_WITHIN_SECONDS) {
    return { ok: false, reason: "not_due" };
  }

  const freshToken = await new SignJWT({
    userId: claims.userId,
    email: claims.email,
    username: claims.username,
    role: claims.role,
    isAdmin: claims.isAdmin,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(session.iat)
    .setExpirationTime("7d")
    .sign(secret);

  return { ok: true, token: freshToken, iat: session.iat };
}
