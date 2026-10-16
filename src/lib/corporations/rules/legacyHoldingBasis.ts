/**
 * Existing shares enter Long Term Holdings. reconstructLegacyHoldingBasis uses
 * recorded costs first, purchase history second, and rollout prices for unknown shares.
 */
import type { ShareHoldingTerms } from "./holdingTerms";
import { validateHoldingTerms } from "./holdingTerms";

export type LegacyHoldingEvent =
  | { kind: "buy"; shares: number; totalAnchor: number }
  | { kind: "sell"; shares: number }
  | { kind: "structure"; beforeShares: number; afterShares: number }
  | { kind: "unknown" };

export interface LegacyBasisResult {
  terms: ShareHoldingTerms;
  source: "recorded" | "history" | "mixed" | "rollout";
  reconstructedShares: number;
  fallbackShares: number;
}

/** Events must arrive in audit order, including every sale and corporate action. */
export function reconstructLegacyHoldingBasis(input: {
  shares: number;
  recordedAverage?: number;
  rolloutAnchorPrice: number;
  events: readonly LegacyHoldingEvent[];
}): LegacyBasisResult {
  const { shares, recordedAverage, rolloutAnchorPrice } = input;
  if (
    !Number.isSafeInteger(shares) ||
    shares < 0 ||
    !Number.isFinite(rolloutAnchorPrice) ||
    rolloutAnchorPrice < 0
  )
    throw new Error("Invalid legacy holding");
  if (recordedAverage !== undefined && (!Number.isFinite(recordedAverage) || recordedAverage < 0))
    throw new Error("Invalid recorded share cost");
  let knownShares = 0;
  let knownBasis = 0;
  // A missing historical opening position is unknown. Retain only the observed
  // suffix, and reconcile to the actual register instead of inventing purchases.
  for (const event of input.events) {
    if (event.kind === "unknown") {
      knownShares = 0;
      knownBasis = 0;
    } else if (event.kind === "buy") {
      if (
        !Number.isSafeInteger(event.shares) ||
        event.shares < 0 ||
        !Number.isFinite(event.totalAnchor) ||
        event.totalAnchor < 0
      )
        throw new Error("Invalid historical purchase");
      knownShares += event.shares;
      knownBasis += event.totalAnchor;
    } else if (event.kind === "sell") {
      if (!Number.isSafeInteger(event.shares) || event.shares < 0)
        throw new Error("Invalid historical sale");
      const remaining = Math.max(0, knownShares - event.shares);
      knownBasis = knownShares ? (knownBasis * remaining) / knownShares : 0;
      knownShares = remaining;
    } else {
      if (
        ![event.beforeShares, event.afterShares].every(
          (value) => Number.isSafeInteger(value) && value >= 0
        )
      )
        throw new Error("Invalid historical restructure");
      if (!event.beforeShares || knownShares > event.beforeShares) {
        knownShares = 0;
        knownBasis = 0;
      } else {
        // Splits conserve basis. Fractional/rounded reallocations cannot prove
        // a partial holder's historical basis, so fall back for that position.
        const scaled = (knownShares * event.afterShares) / event.beforeShares;
        if (!Number.isSafeInteger(scaled)) {
          knownShares = 0;
          knownBasis = 0;
        } else {
          knownShares = scaled;
          if (!scaled) knownBasis = 0;
        }
      }
    }
  }
  if (knownShares > shares) {
    // A missing disposal is not enough evidence to identify the surviving lots.
    knownShares = 0;
    knownBasis = 0;
  }
  const fallbackShares = recordedAverage === undefined ? shares - knownShares : 0;
  const basis =
    recordedAverage !== undefined
      ? shares * recordedAverage
      : knownBasis + fallbackShares * rolloutAnchorPrice;
  const terms: ShareHoldingTerms = {
    longTermShares: shares,
    longTermCostBasisAnchor: basis,
    shortTermLots: [],
  };
  validateHoldingTerms(terms, shares);
  return {
    terms,
    source:
      recordedAverage !== undefined
        ? "recorded"
        : knownShares === shares && shares > 0
          ? "history"
          : knownShares > 0
            ? "mixed"
            : "rollout",
    reconstructedShares: recordedAverage !== undefined ? 0 : knownShares,
    fallbackShares,
  };
}

/** Preserve known register/escrow costs before allocating reconstructed owner history.
 * Partial history cannot identify which unknown shares survived alongside known positions.
 */
export function allocateLegacyUnknownBasis(input: {
  basis: LegacyBasisResult;
  shares: number;
  unknownShares: number;
  knownBasis: number;
  hasKnownPosition: boolean;
  rolloutPrice: number;
}): {
  perShare: number;
  source: LegacyBasisResult["source"];
  reconstructedShares: number;
  fallbackShares: number;
} {
  const { basis, shares, unknownShares, knownBasis, hasKnownPosition, rolloutPrice } = input;
  const totalBasis = basis.terms.longTermCostBasisAnchor;
  const residual = totalBasis - knownBasis;
  const complete = basis.source === "history" && residual >= -1e-8;
  return {
    perShare: !unknownShares
      ? 0
      : complete
        ? Math.max(0, residual) / unknownShares
        : hasKnownPosition
          ? rolloutPrice
          : totalBasis / shares,
    source: complete ? "history" : hasKnownPosition ? "rollout" : basis.source,
    reconstructedShares: complete
      ? unknownShares
      : hasKnownPosition
        ? 0
        : basis.reconstructedShares,
    fallbackShares: complete ? 0 : hasKnownPosition ? unknownShares : basis.fallbackShares,
  };
}
