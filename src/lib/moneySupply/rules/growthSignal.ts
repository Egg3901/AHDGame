/**
 * Money growth is actionable only after comparable observations exist under
 * the current accounting method. currentMoneyGrowth rejects legacy methods
 * and preserves an unavailable observation as null, including after a rebaseline.
 */
import { MONEY_ACCOUNTING_VERSION } from "./calculate";

export function currentMoneyGrowth(
  observation:
    { accountingVersion?: number; annualizedM2GrowthPct: number | null } | null | undefined
): number | null {
  const growth = observation?.annualizedM2GrowthPct;
  return observation?.accountingVersion === MONEY_ACCOUNTING_VERSION &&
    typeof growth === "number" &&
    Number.isFinite(growth)
    ? growth
    : null;
}
