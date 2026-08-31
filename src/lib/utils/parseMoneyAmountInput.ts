/**
 * Parse a money amount typed into a text or number input.
 * `parseFloat("1,000")` yields 1; this strips grouping separators first.
 * Also normalizes full-width digits (IME) to ASCII.
 *
 * Accepts the K/M/B/T shorthand every money figure on screen is printed in
 * ("4.0M" is 4,000,000), so a player can type what they just read instead of
 * spelling it out in plain units (ticket #1236).
 */

/** Multiplier for one trailing shorthand letter. */
const SHORTHAND_MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  t: 1e12,
};

/** A plain number or one with a trailing shorthand letter: `4`, `4.0`, `4.0M`. */
const SHORTHAND_INPUT = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*([kmbt]))?$/i;

export function parseMoneyAmountInput(raw: string): number {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;

  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/[\uFF21-\uFF3A]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff21 + 0x41));
  s = s.replace(/[\uFF41-\uFF5A]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff41 + 0x61));
  s = s.replace(/[,\u00a0\u202f\u3000\uFF0C]/g, "");

  const shorthand = SHORTHAND_INPUT.exec(s);
  if (shorthand) {
    const base = Number(shorthand[1]);
    const multiplier = shorthand[2] ? SHORTHAND_MULTIPLIERS[shorthand[2].toLowerCase()] : 1;
    return base * multiplier;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
