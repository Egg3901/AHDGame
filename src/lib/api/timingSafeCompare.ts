import crypto from "crypto";

/**
 * Constant-time string comparison for secrets (API keys, tokens, admin keys).
 *
 * A plain `===`/`!==` returns as soon as the first differing byte is found, so
 * an attacker can measure response timing to recover a matching prefix one
 * character at a time. `crypto.timingSafeEqual` compares every byte regardless
 * of where the mismatch is.
 *
 * Length is checked first (and short-circuits): `timingSafeEqual` throws on
 * unequal-length buffers, and the length of a secret is not itself sensitive.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
