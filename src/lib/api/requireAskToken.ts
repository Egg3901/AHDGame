import { timingSafeCompare } from "@/lib/api/timingSafeCompare";

/**
 * Validates the server-to-server bearer token used by the Ask service
 * (ask.lakesidegames.net) to push quality-credit and watch notifications
 * into AHD inboxes.
 *
 * Expects `Authorization: Bearer <token>` matching env `ASK_S2S_TOKEN`.
 * Constant-time comparison, mirroring requireLakesideToken. Fails closed
 * when the env var is unset.
 *
 * @returns true if the request carries the configured token, false otherwise.
 */
export function requireAskToken(request: Request): boolean {
  const secret = process.env.ASK_S2S_TOKEN?.trim();
  if (!secret) return false;

  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;

  return timingSafeCompare(match[1], secret);
}
