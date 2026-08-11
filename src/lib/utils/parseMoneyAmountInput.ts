/**
 * Parse a money amount typed into a text or number input.
 * `parseFloat("1,000")` yields 1; this strips grouping separators first.
 * Also normalizes full-width digits (IME) to ASCII.
 */
export function parseMoneyAmountInput(raw: string): number {
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;

  s = s.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/[,\u00a0\u202f\u3000\uFF0C]/g, "");

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
