import { timingSafeEqual } from "node:crypto";

/**
 * Check if the request is authorized as a cron job.
 * Cron routes should use Authorization: Bearer ***.
 *
 * Uses crypto.timingSafeEqual to prevent timing attacks on the Bearer token
 * comparison.
 *
 * @param request - The incoming request
 * @returns true if the request has valid cron auth
 */
export function requireCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (!auth) return false;

  const expected = `Bearer ${secret}`;
  const bufAuth = Buffer.from(auth);
  const bufExpected = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch — guard first (length is not secret).
  if (bufAuth.length !== bufExpected.length) return false;
  return timingSafeEqual(bufAuth, bufExpected);
}
