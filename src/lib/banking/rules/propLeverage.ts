/**
 * Prop-book leverage: how much of its own investments a bank may run against
 * its equity base.
 *
 * Moved verbatim from `banking/propTrading.ts` (the shell that enforces it at
 * open and at forced liquidation) so read-only consumers like the console
 * outlook can use the same numbers without pulling the shell's database,
 * ledger, and turn-clock imports into their module graph. The shell
 * re-exports everything here, so every existing import keeps resolving to
 * this one implementation.
 */

import type { BankCharter, PropPosition } from "@/lib/db/types/bank";

/** Provisional - max propBookMarkValue / equityBase. */
export const PROP_LEVERAGE_MULTIPLE = 3;

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Equity base for prop leverage: bank cash + prop mark - interbank debt - CB
 * margin debt. Corporations have no CB savings surface (characters do), so
 * nothing is netted for CB-held savings.
 *
 * `postedCapital` is deliberately absent. Posting capital moves cash into
 * `cashReserves` and increments the memo, so adding both counted the same money
 * twice and handed every bank a free slice of leverage headroom equal to its
 * contributed capital.
 */
export function computePropEquityBase(
  cashReserves: number,
  charter: Pick<BankCharter, "propBookMarkValue" | "interbankDebt" | "cbMarginDebt" | "propBook">,
  markValueOverride?: number
): number {
  const liquid = Math.max(0, finiteOrZero(cashReserves));
  const mark =
    markValueOverride !== undefined
      ? Math.max(0, finiteOrZero(markValueOverride))
      : charter.propBookMarkValue !== undefined
        ? Math.max(0, finiteOrZero(charter.propBookMarkValue))
        : sumPositionMarks(charter.propBook);
  const interbank = Math.max(0, finiteOrZero(charter.interbankDebt ?? 0));
  const margin = Math.max(0, finiteOrZero(charter.cbMarginDebt ?? 0));
  return liquid + mark - interbank - margin;
}

export function sumPositionMarks(positions: PropPosition[] | undefined): number {
  if (!positions || positions.length === 0) return 0;
  let total = 0;
  for (const p of positions) {
    total += Math.max(0, finiteOrZero(p.markValue ?? p.costBasis));
  }
  return total;
}
