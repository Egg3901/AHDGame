/**
 * Portable rules for the "keep the target as a subsidiary" acquisition outcome.
 *
 * Plain data in, plain data out: no database, clock, randomness or environment.
 * The shell (`../subsidiaryOutcome.ts`) loads documents, gathers the facts this
 * module judges, and writes the result back.
 *
 * The relationship itself is never stored as a parent pointer. It is derived
 * from the cap table (a corporate holder with more than 50% of the voting
 * power) plus the formalization marker, exactly as for any other subsidiary, so
 * the outcome only has to produce those two facts and every existing
 * subsidiary surface (group pages, parent powers, tax group, ownership cycle
 * guard) picks the target up unchanged.
 */

import type { AcquisitionOutcome } from "@/lib/db/types/acquisitionOffer";

/** Legacy offers carry no outcome and always merge. */
export function acquisitionOutcomeOf(offer: { outcome?: AcquisitionOutcome }): AcquisitionOutcome {
  return offer.outcome === "subsidiary" ? "subsidiary" : "merge";
}

export type SubsidiaryCeoConflict = "parent" | "sibling";

/**
 * Everything the subsidiary outcome is judged on, resolved by the shell. Booleans
 * and enums only, so the judgement is deterministic and easy to replay anywhere.
 */
export interface SubsidiaryAcquisitionFacts {
  /** The world-level subsidiary feature gate. */
  featureEnabled: boolean;
  acquirerStateOwned: boolean;
  /** The acquirer is itself a formalized subsidiary (no chaining). */
  acquirerIsFormalizedSubsidiary: boolean;
  targetStateOwned: boolean;
  /** A corporation OTHER than the acquirer already holds more than 50% of the target. */
  targetHasOtherControllingParent: boolean;
  /** The target already carries the formalization marker. */
  targetIsFormalizedSubsidiary: boolean;
  /** The target holds more than 50% of some other corporation (a chain). */
  targetControlsOtherCorporations: boolean;
  /** The target already controls the acquirer, directly or through a chain. */
  wouldCreateOwnershipCycle: boolean;
  /**
   * One-person rule for a human-run target: the sitting human CEO is also the
   * acquirer's owner or CEO, or already runs a sibling subsidiary. Null for an
   * NPP-run target, which occupies no human seat.
   */
  ceoConflict: SubsidiaryCeoConflict | null;
}

export interface SubsidiaryBlock {
  error: string;
  status: number;
}

/**
 * First reason this acquisition may not keep the target as a subsidiary, or null
 * when it may. Mirrors the gates `formalizeSubsidiary` applies to a corporation
 * that reaches majority control by buying shares, so the two routes into a
 * subsidiary can never disagree about who is eligible.
 */
export function subsidiaryAcquisitionBlock(
  facts: SubsidiaryAcquisitionFacts
): SubsidiaryBlock | null {
  if (!facts.featureEnabled) {
    return {
      error:
        "Subsidiary corporations are not enabled in this world, so only outright acquisition is available.",
      status: 400,
    };
  }
  if (facts.acquirerStateOwned || facts.acquirerIsFormalizedSubsidiary) {
    return {
      error:
        "This corporation cannot act as a parent (national corporations and existing subsidiaries are excluded).",
      status: 403,
    };
  }
  if (facts.targetStateOwned) {
    return { error: "National corporations cannot be held as subsidiaries.", status: 400 };
  }
  if (facts.targetHasOtherControllingParent) {
    return {
      error:
        "That corporation is already controlled by another corporation. Its owner decides whether it is sold.",
      status: 400,
    };
  }
  if (facts.targetIsFormalizedSubsidiary) {
    return { error: "That corporation is already a formalized subsidiary.", status: 400 };
  }
  if (facts.targetControlsOtherCorporations) {
    return {
      error:
        "That corporation controls other corporations, and subsidiaries cannot be chained. Acquire it outright instead, or have it release its holdings first.",
      status: 400,
    };
  }
  if (facts.wouldCreateOwnershipCycle) {
    return {
      error:
        "That corporation already controls yours, directly or through a chain of subsidiaries. Buying it would create a circular ownership loop.",
      status: 400,
    };
  }
  if (facts.ceoConflict === "sibling") {
    return {
      error:
        "The target's CEO already operates another of your subsidiaries. A player can run only one subsidiary of the same parent.",
      status: 400,
    };
  }
  if (facts.ceoConflict === "parent") {
    return {
      error:
        "A subsidiary must be run by a different player than the parent. The target's CEO is also running your corporation.",
      status: 400,
    };
  }
  return null;
}

/**
 * The acquirer's whole position after the buyout. One holder, every share, with
 * the agreed price spread over the share count as its cost basis (₳ per share).
 */
export function wholeCorporationPosition(input: { totalShares: number; priceAnchor: number }): {
  shares: number;
  avgCostPerShare: number;
} {
  const shares = Math.max(0, Math.floor(input.totalShares));
  return {
    shares,
    avgCostPerShare: shares > 0 ? Math.max(0, input.priceAnchor) / shares : 0,
  };
}

/** True when the cap table is exactly one corporate holder owning every share. */
export function holdsWholeCapTable(
  shareholders: ReadonlyArray<{ corporationId?: { toString(): string }; shares: number }>,
  holderId: string,
  totalShares: number
): boolean {
  const live = shareholders.filter((row) => row.shares > 0);
  return (
    live.length === 1 &&
    live[0].corporationId?.toString() === holderId &&
    live[0].shares >= totalShares
  );
}
