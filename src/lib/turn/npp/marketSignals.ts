/**
 * Market-signal and target-selection helpers for the NPP corporation brain.
 *
 * Split out of `nppCorporationBehavior` when the v5 strategy loop pushed that
 * file past the 2000 LOC architecture cap. These belong together and apart from
 * the decision sections: they answer "what does the market look like and where
 * could this corp go", with no reference to the corp's budgets, cash rails or
 * strategy. The decision sections consume them.
 */

import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import { SECTOR_SUPPLY, type CommodityType } from "@/lib/constants/commodities";
import { clampProductionPolicy } from "@/lib/utils/productionPolicy";

// Macro-aware production policy (SP5). A +33% price premium saturates to the
// +25 policy bound; sub-5% moves are ignored so the policy does not churn on
// market noise.
const PRODUCTION_POLICY_SENSITIVITY = 75;
const PRODUCTION_POLICY_DEADBAND = 0.05;

/**
 * Shortage score (weighted output price ratio) at or above which a commodity
 * is treated as CRITICALLY short — its producer sector jumps the founding type
 * cascade so any cash-healthy NPP can build it, regardless of the corp's own
 * primary/secondary type.
 *
 * Why: a commodity produced by a SINGLE sector type has no builder pool unless
 * an NPP happens to be that type. Freight ← logistics is the archetype: freight
 * is a recipe input to six sector classes (the whole physical economy) yet only
 * logistics makes it, so when logistics is seeded thin the shortage is
 * structurally unanswerable — the type tiers below never surface logistics for
 * an agriculture/manufacturing corp, no matter how far freight has spiked
 * (observed on prod 2026-08-16: freight 2.0x base, 19% US coverage, and no NPP
 * founding it). 1.6 clears genuine multi-turn shortages without firing on a
 * mild 1.1x premium, and self-disarms: as capacity lands the ratio falls back
 * under the bar. Both ordinary and exceptional entry remain paced and bounded
 * by the corporation's logistics-supported footprint.
 */
export const ESSENTIAL_SHORTAGE_SCORE = 1.6;

/** A function that returns currentPrice/basePrice for a commodity in a country,
 *  or null when no price signal is available. */
export type CommodityPriceRatioFn = (commodity: CommodityType, countryId: string) => number | null;

/**
 * Optional state-resolution placement signals (supply-dislocation remediation,
 * t202). Without these the expansion ranking runs at country resolution, which
 * is exactly what concentrated supply into a handful of states while others
 * starved: a US corp saw one national iron ratio, so MN's idle deposits and
 * NY's starvation were the same number. Both signals are optional so callers
 * without the data (tests, hasEnterableHeadroom) degrade to country scope.
 */
export interface PlacementSignals {
  /** currentPrice/basePrice for a commodity in a STATE; null falls back to the
   *  country-scope ratio for that commodity. */
  statePriceRatioOf?: (commodity: CommodityType, stateId: string) => number | null;
  /**
   * Deposit headroom factor in [0, 1] for founding an extraction sector in a
   * state: 1 = deposits wide open, 0 = no unclaimed capacity. Candidates at 0
   * are dropped outright — a depositless extraction founding clamps at zero
   * output forever, it is never the right build.
   */
  extractionHeadroomOf?: (stateId: string) => number;
  /** Treatment gate: route an existing entry slot to uncovered markets first. */
  preferEmptyMarkets?: boolean;
  /** Active state-sector cells, updated as this cohort founds new sectors. */
  activeMarketBuckets?: Set<string>;
}

export function buildActiveMarketBuckets(sectors: readonly CorporateSector[]): Set<string> {
  return new Set(
    sectors
      .filter((sector) => sector.mothballed !== true)
      .map((sector) => bucketKey(sector.stateId, sector.sectorType))
  );
}

export function markMarketsActive(
  signals: PlacementSignals,
  sectors: readonly Pick<CorporateSector, "stateId" | "sectorType">[] | undefined
): void {
  for (const sector of sectors ?? []) {
    signals.activeMarketBuckets?.add(bucketKey(sector.stateId, sector.sectorType));
  }
}

/**
 * Neighboring states on the corporation's current geographic frontier.
 * Expansion radiates from every occupied home-country state. A corporation
 * with no sectors starts from its headquarters.
 */
export function expansionFrontierStates(
  countryId: CountryId,
  headquartersState: string,
  sectors: readonly CorporateSector[]
): ReadonlySet<string> {
  const occupied = new Set(
    sectors
      .filter((sector) => (sector.countryId ?? countryId) === countryId)
      .map((sector) => sector.stateId)
  );
  const origins = occupied.size > 0 ? occupied : new Set([headquartersState]);
  const frontier = new Set<string>();

  for (const stateId of origins) {
    for (const adjacentState of adjacentStates(countryId, stateId)) {
      if (!occupied.has(adjacentState)) frontier.add(adjacentState);
    }
  }

  return frontier;
}

/**
 * Score multiplier for a candidate in the corp's HQ state. Replaces the old
 * unconditional HQ-first pick, which returned any open HQ bucket before scoring
 * ran at all — every NPP corp piled supply into its HQ state regardless of
 * where demand was (the single biggest driver of the t202 geographic supply
 * concentration: e.g. 95% of rare_earth supply in 3 states). A bonus keeps the
 * home-market pull as a preference the shortage signal can overrule.
 */
export const HQ_STATE_SCORE_BONUS = 1.3;

/**
 * Is there any bucket this corp could actually enter? The strategy loop needs
 * to tell "healthy and boxed in" (defend) from "healthy with somewhere to go"
 * (expand), and headroom is the difference. Reuses the same ranking the
 * expansion path spends against, so the signal and the action agree.
 */
export function hasEnterableHeadroom(
  corp: Corporation,
  sectors: CorporateSector[],
  unownedByCountry: Map<string, UnownedSector[]>,
  stateControlled: ReadonlySet<string>,
  plantsEnabled: boolean,
  eraUnitScale: number
): boolean {
  const frontier = expansionFrontierStates(corp.countryId, corp.headquartersState, sectors);
  return (
    findBestUnownedSector(
      corp.countryId,
      corp.headquartersState,
      corp.type,
      corp.secondaryType,
      new Set(sectors.map((sec) => bucketKey(sec.stateId, sec.sectorType))),
      unownedByCountry,
      stateControlled,
      () => null,
      plantsEnabled,
      eraUnitScale,
      undefined,
      frontier
    ) !== null
  );
}

/**
 * Find the best unowned sector for expansion, prioritizing sectors that
 * match the corp's primary type, then secondary type, then the open market.
 *
 * Within each tier candidates are ranked by revenue × shortage score
 * (smarter-NPP, t879): revenue alone routed every expansion to the biggest
 * bucket regardless of market condition, flooding gluts while shortage
 * commodities went unserved. Weighting by the outputs' price-over-base ratio
 * points new capacity at unmet demand — the price signal then decays as the
 * shortage fills, so the herd self-disperses.
 */
export function findBestUnownedSector(
  countryId: CountryId,
  hqState: string,
  primaryType: string,
  secondaryType: string | null | undefined,
  existingBuckets: ReadonlySet<string>,
  unownedByCountry: Map<string, UnownedSector[]>,
  stateControlled: ReadonlySet<string>,
  priceRatioOf: CommodityPriceRatioFn,
  plantsEnabled: boolean = false,
  eraUnitScale: number = 1,
  signals?: PlacementSignals,
  preferredStateIds?: ReadonlySet<string>
): UnownedSector | null {
  const countryUnowned = unownedByCountry.get(countryId);
  if (!countryUnowned || countryUnowned.length === 0) return null;

  // Under plants a market's size IS its headroom in capacity units, and that is
  // also what the founding build is sized and priced off — so rank on the same
  // quantity the decision spends against. Ranking on ₳ revenue there would sort
  // markets by a nameplate the plants engine no longer treats as authoritative,
  // and would mis-order two markets whose commodity mixes price differently.
  const sizeOf = (us: UnownedSector) =>
    plantsEnabled
      ? unownedHeadroomUnitsOf(
          us.sectorType as CorporationType,
          us.headroomUnits,
          us.revenue,
          eraUnitScale
        )
      : us.revenue;

  // Filter to unoccupied buckets with a positive pool, excluding buckets a
  // National Corporation controls (don't expand into a nationalized sector) and
  // extraction buckets whose state has zero unclaimed deposit capacity.
  const candidates = countryUnowned.filter(
    (us) =>
      !existingBuckets.has(bucketKey(us.stateId, us.sectorType)) &&
      sizeOf(us) > 0 &&
      !stateControlled.has(bucketKey(us.stateId, us.sectorType)) &&
      !(
        us.sectorType === "extraction" &&
        signals?.extractionHeadroomOf !== undefined &&
        signals.extractionHeadroomOf(us.stateId) <= 0
      )
  );

  if (candidates.length === 0) return null;

  // Prefer the adjacent frontier when it has an enterable market. If topology
  // data is absent, an island has no open neighbor, or every neighboring pool
  // is blocked, fall back to the country pool so geography does not become a
  // permanent ceiling.
  const frontierCandidates =
    preferredStateIds && preferredStateIds.size > 0
      ? candidates.filter((candidate) => preferredStateIds.has(candidate.stateId))
      : [];
  const rankedCandidates = frontierCandidates.length > 0 ? frontierCandidates : candidates;
  const activeMarketBuckets = signals?.activeMarketBuckets;
  const uncoveredCandidates =
    signals?.preferEmptyMarkets && activeMarketBuckets
      ? rankedCandidates.filter(
          (candidate) =>
            !activeMarketBuckets.has(bucketKey(candidate.stateId, candidate.sectorType)) &&
            (!plantsEnabled ||
              sizeOf(candidate) >= foundingStarterUnits(candidate.sectorType as CorporationType))
        )
      : [];
  const entryCandidates = uncoveredCandidates.length > 0 ? uncoveredCandidates : rankedCandidates;

  // Shortage at the candidate's own state when a state price exists, country
  // otherwise. This is what routes a founding to the state that is actually
  // starved instead of treating every state in the country as one market.
  const shortageOf = (c: UnownedSector) =>
    sectorShortageScore(c.sectorType as CorporationType, countryId, (commodity, cid) => {
      const stateRatio = signals?.statePriceRatioOf?.(commodity, c.stateId);
      return stateRatio ?? priceRatioOf(commodity, cid);
    });
  const score = (c: UnownedSector) => {
    let s = sizeOf(c) * shortageOf(c);
    if (c.sectorType === "extraction" && signals?.extractionHeadroomOf) {
      s *= signals.extractionHeadroomOf(c.stateId);
    }
    if (c.stateId === hqState) s *= HQ_STATE_SCORE_BONUS;
    return s;
  };
  // Peak shortage = the price ratio of this sector's SHORTEST single output.
  // The blended `shortageOf` averages a short output against healthy ones
  // (logistics makes freight 0.45 AND consulting 0.25), which would hide a
  // genuine single-input crisis behind a co-product. The essential-shortage
  // override gates on the peak so freight at 2.0x triggers logistics even
  // though consulting is at base.
  const peakShortageOf = (c: UnownedSector): number =>
    sectorPeakShortageScore(c.sectorType as CorporationType, countryId, priceRatioOf);
  // Highest market-weighted score wins; the HQ state gets a score bonus, not
  // the old unconditional first pick (see HQ_STATE_SCORE_BONUS).
  const best = (list: UnownedSector[]) => list.sort((a, b) => score(b) - score(a))[0];

  // Tier 0 — essential-shortage override: a commodity whose producer sector is
  // critically short jumps the type cascade, so a single-source input like
  // freight (produced only by logistics) actually gets built by whichever
  // cash-healthy NPP can, instead of waiting for a same-type corp that may not
  // exist. Highest size×shortage wins; disarms once capacity pulls the ratio
  // back under ESSENTIAL_SHORTAGE_SCORE. See the constant for the full rationale.
  const critical = entryCandidates.filter((c) => peakShortageOf(c) >= ESSENTIAL_SHORTAGE_SCORE);
  if (critical.length > 0) return critical.sort((a, b) => score(b) - score(a))[0];

  // Tier 1: primary type match
  const primaryMatch = entryCandidates.filter((c) => c.sectorType === primaryType);
  if (primaryMatch.length > 0) return best(primaryMatch);

  // Tier 2: secondary type match
  if (secondaryType) {
    const secondaryMatch = entryCandidates.filter((c) => c.sectorType === secondaryType);
    if (secondaryMatch.length > 0) return best(secondaryMatch);
  }

  // Tier 3: open market — market-weighted score across all types
  return best(entryCandidates);
}

/**
 * Macro-aware production-policy target for a sector, derived from the
 * price-vs-base ratio of the commodities its type SUPPLIES. Returns an integer
 * in [0, 25], or null when the sector type produces no priced commodity (so
 * the caller leaves the existing policy untouched).
 *
 * Elevated price (shortage/premium) → positive policy (ramp output to capture
 * the premium and add supply). Depressed price (glut) → 0, not negative:
 * productionPolicy's intentional lean-ops asymmetry cuts input demand (−15% at
 * −25) harder than output (−10%), so economy-wide NPP contraction *worsens*
 * gluts and permanently pins sectors at max contraction (1953-default audit,
 * GH #3370). Glut capacity is reduced via targetGrowthRate instead (section 2a).
 */
export function computeMacroProductionPolicy(
  sectorType: CorporationType,
  countryId: string,
  priceRatioOf: CommodityPriceRatioFn
): number | null {
  const supply = SECTOR_SUPPLY[sectorType];
  if (!supply || supply.length === 0) return null;

  let weightedDeviation = 0;
  let totalWeight = 0;
  for (const { commodity, rate } of supply) {
    const ratio = priceRatioOf(commodity, countryId);
    if (ratio == null || !Number.isFinite(ratio)) continue;
    weightedDeviation += rate * (ratio - 1);
    totalWeight += rate;
  }
  if (totalWeight === 0) return null;

  const deviation = weightedDeviation / totalWeight;
  if (Math.abs(deviation) < PRODUCTION_POLICY_DEADBAND) return 0;
  // Floor at 0: never command lean-ops contraction from a glut price signal.
  return Math.max(0, clampProductionPolicy(deviation * PRODUCTION_POLICY_SENSITIVITY));
}

/**
 * Supply-weighted mean price-over-base ratio of a sector type's outputs —
 * the market's "how badly is this wanted" signal. > 1 = shortage premium,
 * < 1 = glut. Returns 1 (neutral) when no output is priced, so unpriced
 * sector types rank neither up nor down.
 *
 * Smarter-NPP remediation (t879): expansion and growth were market-blind —
 * capital flowed to whatever bucket had the highest revenue, flooding gluts
 * while shortage commodities stayed unserved. Pricing the shortage into the
 * decision routes NPP capital toward unmet demand, which grows aggregate
 * cleared volume under BOTH ledger and clearing modes.
 */
export function sectorShortageScore(
  sectorType: CorporationType,
  countryId: string,
  priceRatioOf: CommodityPriceRatioFn
): number {
  const supply = SECTOR_SUPPLY[sectorType];
  if (!supply || supply.length === 0) return 1;
  let weighted = 0;
  let totalWeight = 0;
  for (const { commodity, rate } of supply) {
    const ratio = priceRatioOf(commodity, countryId);
    if (ratio == null || !Number.isFinite(ratio)) continue;
    weighted += rate * ratio;
    totalWeight += rate;
  }
  return totalWeight > 0 ? weighted / totalWeight : 1;
}

/**
 * Highest live price-over-base ratio among a sector type's outputs. This is the
 * essential-shortage signal used for entry: a critical single output must not
 * be hidden by a balanced co-product in the weighted sector average.
 */
export function sectorPeakShortageScore(
  sectorType: CorporationType,
  countryId: string,
  priceRatioOf: CommodityPriceRatioFn
): number {
  const supply = SECTOR_SUPPLY[sectorType];
  if (!supply || supply.length === 0) return 0;
  let peak = 0;
  for (const { commodity } of supply) {
    const ratio = priceRatioOf(commodity, countryId);
    if (ratio != null && Number.isFinite(ratio) && ratio > peak) peak = ratio;
  }
  return peak;
}
