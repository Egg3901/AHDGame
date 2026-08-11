import { timingSafeCompare } from "@/lib/api/timingSafeCompare";

/**
 * Validates the server-to-server bearer token used by the Lakeside account
 * portal to push subscription state into AHD.
 *
 * Expects `Authorization: Bearer <token>` matching env `LAKESIDE_S2S_TOKEN`.
 * Uses a constant-time comparison, mirroring the requireBotToken pattern.
 *
 * @returns true if the request carries the configured token, false otherwise.
 */
export function requireLakesideToken(request: Request): boolean {
  const secret = process.env.LAKESIDE_S2S_TOKEN?.trim();
  if (!secret) return false;

  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;

  return timingSafeCompare(match[1], secret);
}
