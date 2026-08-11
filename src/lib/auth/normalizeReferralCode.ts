/**
 * Normalize a pasted / cookie / query referral code to a lowercase 24-char
 * ObjectId hex string, or null if it isn't a valid code.
 *
 * Accepts accidental whitespace and uppercase hex; silently rejects anything
 * else so OAuth flows are never blocked by a bad paste.
 *
 * Client-safe — no Node/Mongo imports (used from the register page).
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  try {
    // Cookie values are encodeURIComponent'd on the register page.
    value = decodeURIComponent(value).trim();
  } catch {
    // Malformed % sequences — fall through with the raw trim.
  }
  value = value.toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(value)) return null;
  return value;
}
