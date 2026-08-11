import { timingSafeCompare } from "@/lib/api/timingSafeCompare";

/**
 * Validates the X-Bot-Token header against configured bot API keys.
 *
 * @param request - The incoming Next.js request
 * @param allowPublicKey - If true (default), also accepts PUBLIC_BOT_API_KEY in addition
 *   to DISCORD_BOT_API_KEY. Pass false for sensitive endpoints (e.g. blackjack) that
 *   should only be accessible with the full private key.
 * @returns true if the request carries a valid token, false otherwise
 */
export function requireBotToken(request: Request, allowPublicKey = true): boolean {
  const token = request.headers.get("X-Bot-Token");
  if (!token) return false;

  const privateKey = process.env.DISCORD_BOT_API_KEY;
  if (privateKey && timingSafeCompare(token, privateKey)) return true;

  if (allowPublicKey) {
    const publicKey = process.env.PUBLIC_BOT_API_KEY;
    if (publicKey && timingSafeCompare(token, publicKey)) return true;
  }

  return false;
}

/**
 * Validates X-Bot-Token strictly against PUBLIC_BOT_API_KEY.
 * Use for read-only public bot endpoints that should not require private/admin keys.
 */
export function requirePublicBotToken(request: Request): boolean {
  const token = request.headers.get("X-Bot-Token");
  if (!token) return false;
  const publicKey = process.env.PUBLIC_BOT_API_KEY;
  return !!publicKey && timingSafeCompare(token, publicKey);
}
