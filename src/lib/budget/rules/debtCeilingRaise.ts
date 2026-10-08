/**
 * Routine statutory debt-ceiling increase. Governments of the period raised
 * their limit whenever the stock neared it; the stored ceiling is seeded about
 * 10% above opening debt and no law moves it, so without this every deficit
 * year walks the ratio past 1.0.
 */

/** Principal / ceiling at or above which the legislature raises the limit at fiscal close. */
export const DEBT_CEILING_RAISE_TRIGGER = 0.95;

/** New ceiling as a multiple of principal, the same headroom the 1991 seeds open with. */
export const DEBT_CEILING_RAISE_HEADROOM = 1.1;

/** The raised ceiling, or null when the stock is not near enough to the current one. */
export function raisedDebtCeiling(input: { principal: number; ceiling: number }): number | null {
  const { principal, ceiling } = input;
  if (!Number.isFinite(principal) || !Number.isFinite(ceiling)) return null;
  if (principal <= 0 || ceiling <= 0) return null;
  if (principal < ceiling * DEBT_CEILING_RAISE_TRIGGER) return null;
  const raised = Math.round(principal * DEBT_CEILING_RAISE_HEADROOM);
  return raised > ceiling ? raised : null;
}
