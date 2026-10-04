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
import { bankEquity, type BalanceSheetCharter, type BalanceSheetOptions } from "./balanceSheet";

/** Provisional - max propBookMarkValue / equityBase. */
export const PROP_LEVERAGE_MULTIPLE = 3;

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Equity base for prop leverage: shared bank book equity plus the marked prop
 * book. Cash-backed deposits and every borrowing remain liabilities. Legacy
 * player savings pointers contribute neither bank cash nor bank liabilities.
 * Corporations have no CB savings surface, so there is no CB savings asset.
 *
 * `postedCapital` is deliberately absent. Posting capital moves cash into
 * `cashReserves` and increments the memo, so adding both counted the same money
 * twice and handed every bank a free slice of leverage headroom equal to its
 * contributed capital.
 */
export function computePropEquityBase(
  cashReserves: number,
  charter: Partial<BalanceSheetCharter> & Pick<BankCharter, "propBookMarkValue" | "propBook">,
  markValueOverride?: number,
  options: BalanceSheetOptions = {}
): number {
  const liquid = Math.max(0, finiteOrZero(cashReserves));
  const mark =
    markValueOverride !== undefined
      ? Math.max(0, finiteOrZero(markValueOverride))
      : charter.propBookMarkValue !== undefined
        ? Math.max(0, finiteOrZero(charter.propBookMarkValue))
        : sumPositionMarks(charter.propBook);
  return bankEquity({ ...charter, cashReserves: liquid }, options) + mark;
}

export function sumPositionMarks(positions: PropPosition[] | undefined): number {
  if (!positions || positions.length === 0) return 0;
  let total = 0;
  for (const p of positions) {
    total += Math.max(0, finiteOrZero(p.markValue ?? p.costBasis));
  }
  return total;
}
