import {
  CONTEST_GAP,
  updateBrandLoyalty,
  type LoyaltyUpdateResult,
} from "@/lib/market/brandLoyalty";

/**
 * Per-turn brand-loyalty rollup (Package A, phase A2). Pure.
 *
 * Loyalty is a CORP-level reputation, but pricing/delivery happen per sector,
 * so each corp is rolled up as a revenue-weighted mean of its selling sectors'
 * effective posture and fill. The "contested" signal — required for accrual —
 * asks whether any RIVAL corp posts at least CONTEST_GAP cheaper in a commodity
 * the corp sells (loyalty earned with no cheaper rival to resist is meaningless,
 * so it is zero there).
 *
 * The turn layer supplies each corp's sectors already joined to their clearing
 * results (effective posture + soldFraction) and prior loyalty state; this
 * module owns the aggregation and the contest index so it can be tested without
 * the DB.
 */

export interface LoyaltySectorInput {
  /** Anchor-normalized (₳) sector revenue — the weight. */
  revenueAnchor: number;
  /** Effective posture used in clearing this turn (player-set or auto). */
  effectivePosture: number;
  /** Sector fill from clearing (0–1). */
  soldFraction: number;
  /** Output commodities this sector sells (rate > 0). */
  commodities: readonly string[];
}

export interface CorpLoyaltyInput {
  corpId: string;
  priorLoyalty: number | null | undefined;
  priorNorm: number | null | undefined;
  sectors: readonly LoyaltySectorInput[];
}

export interface CorpLoyaltyUpdate {
  corpId: string;
  loyalty: number;
  postureNorm: number;
  outcome: LoyaltyUpdateResult["outcome"];
}

/**
 * Per commodity, the cheapest posted posture and the cheapest posted by a
 * DISTINCT second corp — enough to answer "is corp X contested here?" in O(1)
 * even when X itself holds the global minimum.
 */
interface ContestEntry {
  cheapestCorp: string;
  cheapestPosture: number;
  secondCorp: string | null;
  secondPosture: number;
}

function buildContestIndex(corps: readonly CorpLoyaltyInput[]): Map<string, ContestEntry> {
  const idx = new Map<string, ContestEntry>();
  for (const corp of corps) {
    for (const sector of corp.sectors) {
      const posture = Number.isFinite(sector.effectivePosture) ? sector.effectivePosture : 0;
      for (const commodity of sector.commodities) {
        const e = idx.get(commodity);
        if (!e) {
          idx.set(commodity, {
            cheapestCorp: corp.corpId,
            cheapestPosture: posture,
            secondCorp: null,
            secondPosture: Infinity,
          });
          continue;
        }
        if (posture < e.cheapestPosture) {
          // New global minimum. Demote the old cheapest to "second" only if it
          // is a different corp than the newcomer.
          if (e.cheapestCorp !== corp.corpId) {
            e.secondCorp = e.cheapestCorp;
            e.secondPosture = e.cheapestPosture;
          }
          e.cheapestCorp = corp.corpId;
          e.cheapestPosture = posture;
        } else if (corp.corpId !== e.cheapestCorp && posture < e.secondPosture) {
          e.secondCorp = corp.corpId;
          e.secondPosture = posture;
        }
      }
    }
  }
  return idx;
}

/** Cheapest posture posted by a corp OTHER than `corpId` in `commodity`. */
function cheapestRivalPosture(
  idx: Map<string, ContestEntry>,
  commodity: string,
  corpId: string
): number {
  const e = idx.get(commodity);
  if (!e) return Infinity;
  if (e.cheapestCorp !== corpId) return e.cheapestPosture;
  return e.secondPosture; // the global min is our own; fall back to the next distinct corp
}

/**
 * Compute one turn of loyalty updates for every corp. Pure — returns the new
 * loyalty/norm per corp; the caller persists them (only when the feature flag
 * is on). Corps with no selling sectors are skipped (no signal this turn).
 */
export function computeBrandLoyaltyUpdates(
  corps: readonly CorpLoyaltyInput[]
): CorpLoyaltyUpdate[] {
  const contestIdx = buildContestIndex(corps);
  const updates: CorpLoyaltyUpdate[] = [];

  for (const corp of corps) {
    let weight = 0;
    let postureAcc = 0;
    let fillAcc = 0;
    let contested = false;

    for (const sector of corp.sectors) {
      const w = Number.isFinite(sector.revenueAnchor) ? Math.max(0, sector.revenueAnchor) : 0;
      if (w <= 0 || sector.commodities.length === 0) continue;
      const posture = Number.isFinite(sector.effectivePosture) ? sector.effectivePosture : 0;
      const fill = Number.isFinite(sector.soldFraction) ? sector.soldFraction : 0;
      weight += w;
      postureAcc += w * posture;
      fillAcc += w * fill;
      if (!contested) {
        for (const commodity of sector.commodities) {
          if (cheapestRivalPosture(contestIdx, commodity, corp.corpId) <= posture - CONTEST_GAP) {
            contested = true;
            break;
          }
        }
      }
    }

    if (weight <= 0) continue; // no selling sectors → no loyalty signal this turn

    const result = updateBrandLoyalty({
      loyalty: corp.priorLoyalty,
      postureNorm: corp.priorNorm,
      posture: postureAcc / weight,
      fill: fillAcc / weight,
      contested,
    });
    updates.push({
      corpId: corp.corpId,
      loyalty: result.loyalty,
      postureNorm: result.postureNorm,
      outcome: result.outcome,
    });
  }

  return updates;
}
