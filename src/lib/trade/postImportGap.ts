/**
 * Display-only: the supply gap that REMAINS once imports have reached a market.
 *
 * Own-production supply against own-production demand overstates scarcity for
 * any market that buys part of its needs abroad. Clearing is global-pooled, so
 * imports fill that demand (usually at a lower price) and a "75% undersupplied"
 * national figure can sit beside a world market that is in surplus. These
 * helpers net imports out so the figure matches what a player can act on.
 *
 * Pure: plain numbers in, plain numbers out. No clearing or pricing changes.
 */

export interface PostImportBalance {
  /** Units imported into this market that count against its shortfall. */
  imports: number;
  /** supply + imports - demand. Negative is a shortage that imports did not close. */
  balance: number;
  /** Shortfall left after imports, 0 when imports covered it. */
  remainingShortfall: number;
  /** True when a raw production gap existed and imports closed all of it. */
  coveredByImports: boolean;
}

function cleanUnits(value: number | undefined | null): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function postImportBalance(
  supply: number,
  demand: number,
  imports: number | undefined | null
): PostImportBalance {
  const inbound = cleanUnits(imports);
  const rawGap = Math.max(0, demand - supply);
  const balance = supply + inbound - demand;
  const remainingShortfall = Math.max(0, -balance);
  return {
    imports: inbound,
    balance,
    remainingShortfall,
    coveredByImports: rawGap > 0 && remainingShortfall <= 0,
  };
}

/**
 * Share of a country's raw production deficit that imports closed, 0..1.
 * A country with no deficit has nothing for imports to close.
 */
export function importCoverage(
  nationalSupply: number,
  nationalDemand: number,
  nationalImports: number | undefined | null
): number {
  const deficit = Math.max(0, nationalDemand - nationalSupply);
  if (!(deficit > 0)) return 0;
  return Math.min(1, cleanUnits(nationalImports) / deficit);
}

/**
 * Imports are booked nationally, not per state. Attribute them to a state by
 * the share of the national deficit they closed, applied to that state's own
 * deficit. A state in surplus receives none.
 */
export function stateImportsShare(
  stateSupply: number,
  stateDemand: number,
  coverage: number
): number {
  const deficit = Math.max(0, stateDemand - stateSupply);
  return deficit * Math.min(1, Math.max(0, coverage));
}
