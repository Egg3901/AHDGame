import { offerPriceFactor } from "./rules/offerPricing";
import type { GroupForecastBasis } from "@/lib/corporations/groups/rules/forecast";
import {
  coordinateGroupMarket,
  coordinationSlices,
  type CoordinationBuyer,
  type GroupMarketReceipt,
} from "@/lib/corporations/groups/rules/marketCoordination";
import type { SupplyMember } from "@/lib/corporations/groups/rules/supply";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import {
  reserveInternalSupply,
  finishInternalSupplyCommodity,
  type InternalSupplyClearing,
} from "./internalSupply/clearing";
import { normalizedOfferShare } from "./rules/demandAllocation";
import { placementRevenueLeg } from "./placementRevenuePhase";
import { capDeliveredMediaUnits, type MediaOwnershipMarket } from "@/lib/mediaRegulation/rules";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { commodityMixWeight as mixWeight } from "@/lib/constants/commodities";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { LOYAL_POOL_FRACTION, SLICE_NOISE_FLOOR } from "@/lib/market/brandLoyalty";
import { isStateScopedCommodity, supplyAgreementScopeKey } from "@/lib/market/commodityMarketScope";

/**
 * Market clearing — Tier 3 (Fix 2) of the structural market rework
 * (audit t806; see docs/plans/2026-07-03-market-structural-plan.md).
 *
 * Sellers post a price relative to market (their **pricing posture**,
 * −20%…+20%) and per commodity the (lagged) demand fills sellers
 * cheapest-first. Undercutting fills your order book before rivals';
 * premium posture skims more per unit but sells last and can go unsold in a
 * glut. This is the moment "lower your margin to sell more" becomes
 * literally true.
 *
 * A sector's revenue leg per output commodity becomes:
 *
 *   legFactor = soldFraction × (1 + posture) × priceRealizationFactor(price/base)
 *
 * i.e. volume × your price choice × the macro price level (Tier 1's term —
 * clearing subsumes rather than stacks a second copy: when clearing is on,
 * this factor REPLACES the plain realization multiplier). Sector factor is
 * the supply-rate-weighted mean across outputs, ramped in per sector via the
 * shared 240-turn window.
 *
 * Demand is the PRIOR turn's aggregate (lagged, like every market input in
 * this rework), so clearing can't feed back on itself within a turn.
 */

/** Namespace prefix for state-scoped clearing books. */
const STATE_GROUP_PREFIX = "state:";
const MISSING_STATE_GROUP_PREFIX = "missing-state:";

export {
  PRICING_POSTURE_MIN,
  PRICING_POSTURE_MAX,
  clampPricingPosture,
  costPlusPriceFactor,
} from "./costPlusPricing/rules";
import { clampPricingPosture, costPlusPriceFactor } from "./costPlusPricing/rules";

/**
 * Own-fill feedback thresholds for autoPosture (clearing collapse remediation,
 * 2026-07-06 t879 clone A/B). The aggregate d/s heuristic is blind to the
 * seller's own order-book outcome: a sector can detect a shortage, post +0.1,
 * sell last under cheapest-first, and keep skimming forever while its fill
 * rate sits near zero. These thresholds make the autopilot read its own
 * lagged soldFraction before it prices.
 */
export const AUTO_POSTURE_FILL_CHASE = 0.35;
export const AUTO_POSTURE_FILL_HEALTHY = 0.7;

/**
 * Quality → premium pricing coupling (Package B, qualityPremiumPricingEnabled).
 *
 * Output quality was designed to feed the premium-pricing strategy: a corp that
 * posts a premium price (positive posture) should be REWARDED for high output
 * quality and PENALIZED for low quality — buyers pay up for a quality brand and
 * balk at a premium on a shoddy one. `qualityPremiumMultiplier` scales the
 * PREMIUM portion of the posture (never the base price, never an undercut) by a
 * factor centred on 1.0 at neutral quality (`QUALITY_PREMIUM_REF` = 50, the
 * mid-scale used everywhere in brandQuality). Deliberately conservative: at the
 * ±0.2 posture cap and quality 100, the realized premium widens from +0.20 to
 * at most +0.26 (mult 1.3); at quality 0 it shrinks to +0.14 (mult 0.7).
 */
export {
  QUALITY_PREMIUM_REF,
  QUALITY_PREMIUM_STRENGTH,
  QUALITY_PREMIUM_MULT_MIN,
  QUALITY_PREMIUM_MULT_MAX,
  qualityPremiumMultiplier,
} from "./rules/offerPricing";
/**
 * Automated posture for NPP/unowned sellers: skim into shortages, undercut
 * into gluts, sit at market when balanced. Deliberately milder than the
 * player range so players can always out-position the AI.
 *
 * `lastSoldFraction` (the sector's own lagged fill rate, when known) gates the
 * aggregate heuristic: a seller that failed to clear its book last turn must
 * not skim, and one that barely sold at all undercuts to chase volume —
 * regardless of what the aggregate balance says. Survival beats margin for an
 * unmanaged corp (away-safety, see docs/plans/2026-07-05-corp-policy-engine-ux.md).
 */
export function autoPosture(
  demandUnits: number,
  supplyUnits: number,
  lastSoldFraction?: number | null
): number {
  // Own-fill feedback first: our actual outcome trumps the aggregate signal.
  if (typeof lastSoldFraction === "number" && Number.isFinite(lastSoldFraction)) {
    if (lastSoldFraction < AUTO_POSTURE_FILL_CHASE) return -0.1;
    if (lastSoldFraction < AUTO_POSTURE_FILL_HEALTHY) {
      // Not selling well enough to skim — at most match the market.
      return Math.min(0, autoPostureFromBalance(demandUnits, supplyUnits));
    }
  }
  return autoPostureFromBalance(demandUnits, supplyUnits);
}

/** The original aggregate-balance heuristic (no own-fill signal). */
function autoPostureFromBalance(demandUnits: number, supplyUnits: number): number {
  if (!(supplyUnits > 0) || !(demandUnits > 0)) return 0;
  const ds = demandUnits / supplyUnits;
  if (ds > 1.2) return 0.1;
  if (ds < 0.8) return -0.1;
  return 0;
}

export interface ClearingSeller {
  /** Sector id (or synthetic id for aggregate pools). */
  id: string;
  /** Units offered this turn after any pre-market audience availability limit. */
  units: number;
  /** Physical output before any audience availability limit. */
  physicalUnits?: number;
  /** Editorially available fraction of advertising output. */
  editorialAvailability?: number;
  /** Product-reachable fraction of this physical offer. */
  productAvailability?: number;
  /** Combined editorial and title reach applied to this offer before clearing. */
  availability?: number;
  /** Posted price relative to market, −0.2 … 0.2. */
  posture: number;
  /** Internally resolved quote relative to this book's price; CEO input is still bounded. */
  quotedPosture?: number;
  /**
   * Plants tier: these units came from the seller's OWN measured output
   * (`producedUnits`), not from the revenue nameplate, so they are exempt from
   * the lagged-supply normalization below. Absent/false ⇒ normalized as before.
   */
  realUnits?: boolean;
}

/**
 * Fill one commodity's demand cheapest-first. Sellers at the same posture
 * split the residual demand pro-rata. Returns soldFraction per seller id.
 *
 * When `loyaltyById` is supplied (brand-loyalty slice, A2b), a loyal-slice
 * PRE-PASS runs first: a finite pool (LOYAL_POOL_FRACTION of demand) is split
 * across sellers by RELATIVE loyalty and filled at each seller's own price —
 * loyal customers who don't defect to the cheapest option. The remainder then
 * clears cheapest-first exactly as before. Omitting `loyaltyById` (flag off) is
 * byte-identical to the original cheapest-first behaviour.
 *
 * A supply agreement is ADDITIVE, not restrictive: `contractedUnitsById`
 * reserves the buyer's volume off the top, and everything the supplier produces
 * ABOVE the contract clears on the open market like any other unit. There is no
 * surplus blackhole — a supplier that contracts 50 of 100 still offers the other
 * 50 to the book, so `soldFraction` reflects real total sales (contracted +
 * open-market fill), never `contracted / produced`.
 *
 * Contracted volume is guaranteed ahead of the anonymous order book, up to the
 * supplier's actual offer. The caller already caps reservations by each named
 * buyer's physical demand. Bounding the reservation again by this pass's
 * proportional anonymous demand made valid agreements under-deliver in thin
 * books, such as ticket #1139's 13k freight contract filling only 6.4k.
 */
export function clearCommodityMarket(
  demandUnits: number,
  sellers: readonly ClearingSeller[],
  loyaltyById?: ReadonlyMap<string, number>,
  contractedUnitsById?: ReadonlyMap<string, number>
): Map<string, number> {
  const result = new Map<string, number>();
  let remaining = Math.max(0, demandUnits);

  // Filled units per seller (reservation + cheapest-first), and units still on
  // offer after the loyal reservation is taken off the top.
  const filledUnits = new Map<string, number>();
  const offerUnits = new Map<string, number>();
  for (const s of sellers) {
    filledUnits.set(s.id, 0);
    offerUnits.set(s.id, Math.max(0, s.units));
  }

  // ── Contracted pre-pass (private supply agreements) ────────────────────────
  // Runs FIRST: contracted units are guaranteed-sold for the supplier and leave
  // the open market (demand is reduced), before loyalty or cheapest-first.
  if (contractedUnitsById) {
    for (const s of sellers) {
      const contracted = contractedUnitsById.get(s.id) ?? 0;
      if (contracted <= 0) continue;
      const take = Math.min(contracted, offerUnits.get(s.id) ?? 0);
      if (take <= 0) continue;
      filledUnits.set(s.id, (filledUnits.get(s.id) ?? 0) + take);
      offerUnits.set(s.id, (offerUnits.get(s.id) ?? 0) - take);
      remaining -= take;
    }
    remaining = Math.max(0, remaining);
  }

  // ── Loyal-slice pre-pass ───────────────────────────────────────────────────
  if (loyaltyById && remaining > 0) {
    // Eligibility and the reservation both read `offerUnits`, not `s.units`, so
    // the contracted pre-pass above is respected (a seller cannot reserve units
    // it has already sold). With no contracts in play `offerUnits === s.units`,
    // so this is byte-identical to the original slice.
    const eligible = sellers.filter(
      (s) => (loyaltyById.get(s.id) ?? 0) >= SLICE_NOISE_FLOOR && (offerUnits.get(s.id) ?? 0) > 0
    );
    const totalLoyalty = eligible.reduce(
      (sum, s) => sum + Math.max(0, loyaltyById.get(s.id) ?? 0),
      0
    );
    if (totalLoyalty > 0) {
      const pool = LOYAL_POOL_FRACTION * remaining;
      for (const s of eligible) {
        const share = pool * (Math.max(0, loyaltyById.get(s.id) ?? 0) / totalLoyalty);
        const available = offerUnits.get(s.id) ?? 0;
        const reserve = Math.min(share, available); // never more than the seller still offers
        filledUnits.set(s.id, (filledUnits.get(s.id) ?? 0) + reserve);
        offerUnits.set(s.id, available - reserve);
        remaining -= reserve;
      }
      remaining = Math.max(0, remaining);
    }
  }

  // ── Cheapest-first over the remaining demand and unreserved units ──────────
  const byPosture = new Map<number, ClearingSeller[]>();
  for (const s of sellers) {
    const p = s.quotedPosture ?? clampPricingPosture(s.posture);
    byPosture.set(p, [...(byPosture.get(p) ?? []), s]);
  }
  for (const posture of [...byPosture.keys()].sort((a, b) => a - b)) {
    const group = byPosture.get(posture)!;
    const groupUnits = group.reduce((sum, s) => sum + (offerUnits.get(s.id) ?? 0), 0);
    const fillFraction = groupUnits <= 0 ? 0 : Math.min(1, remaining / groupUnits);
    for (const s of group) {
      const offered = offerUnits.get(s.id) ?? 0;
      filledUnits.set(s.id, (filledUnits.get(s.id) ?? 0) + offered * fillFraction);
    }
    remaining = Math.max(0, remaining - groupUnits * fillFraction);
  }

  // soldFraction = total filled ÷ original units offered.
  for (const s of sellers) {
    const orig = Math.max(0, s.units);
    result.set(s.id, orig > 0 ? Math.min(1, (filledUnits.get(s.id) ?? 0) / orig) : 0);
  }
  return result;
}

export interface SectorClearingInput {
  sectorId: string;
  /**
   * Sector's revenue base (drives offered units per output).
   * MUST be anchor-normalized (₳) — sector.revenue is stored in the corp's
   * LOCAL currency, and the lagged balances/demand this book clears against
   * are ₳-denominated (commodityPriceTurn anchor-normalizes before unit
   * accumulation). Feeding raw local revenue inflates a JPY corp's offered
   * units ~100× and an NGN corp's ~1900×, drowning the whole book: the t879
   * clone A/B showed corporate mean fill ~0.13 in a market whose aggregate
   * flows cleared 88%, with undercutters filling WORSE than at-market sellers.
   */
  revenue: number;
  /** Output rates (strategy supply). */
  supplyRates: Partial<Record<CommodityType, number>>;
  /** Exact per-commodity physical offers from a product line, when enabled. */
  outputUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  /** Fraction of each physical offer reachable by current media product titles. */
  offerAvailabilityByCommodity?: Partial<Record<CommodityType, number>>;
  /** Host-state placement cap for each output, independent of other commodities. */
  offerPlacementByCommodity?: Partial<Record<CommodityType, number>>;
  /** Conserved nominal output value by commodity, used to weight sector realization. */
  outputAnchorByCommodity?: Partial<Record<CommodityType, number>>;
  /** Product quality by output commodity, overriding the legacy corp average for that output. */
  productQualityByCommodity?: Partial<Record<CommodityType, number>>;
  /** Project-only redirected units offered, excluding the strategy recipe baseline. */
  projectOutputUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  /** Product quality for the active project, independent of quality-premium pricing. */
  projectQualityByCommodity?: Partial<Record<CommodityType, number>>;
  /** Active project identity for the project-owned offer snapshot. */
  productProjectId?: string;
  /** Turn that produced the project-owned offer. */
  productOutputTurn?: number;
  /** Posted posture (player-set), or null to auto-position (NPP/unowned). */
  posture: number | null;
  /** Flag-gated input basket index for cost-plus pricing, otherwise absent. */
  inputCostIndex?: number;
  /** Recipe's base material spend as a share of nominal output value. */
  inputCostShare?: number;
  /** Recorded payroll, overhead, upkeep and compliance per nominal output value. */
  fixedCostShare?: number;
  /**
   * The sector's own soldFraction from the PRIOR turn (lagged, like every
   * other clearing input), if known. Feeds autoPosture's own-fill feedback;
   * ignored for player-posted postures.
   */
  lastSoldFraction?: number | null;
  /**
   * Owning corp's brand loyalty (0–100), lagged. Only consulted when the
   * caller opts into the loyal-slice pre-pass (brandLoyaltySliceEnabled).
   * Absent ⇒ treated as 0 (no protected slice).
   */
  brandLoyalty?: number | null;
  /**
   * Owning corp's lagged output quality (0–100), supplied only when the caller
   * opts into the quality→premium coupling (qualityPremiumPricingEnabled). Used
   * to scale the premium portion of a positive posture; null/undefined ⇒ no
   * quality effect on this sector's premium.
   */
  outputQuality?: number | null;
  /**
   * Plants tier (marketSystemMode >= "plants"): the units this sector actually
   * produced last turn (`sector.producedUnits`, daily, currency-free), already
   * carrying the canonical ledger-side legs the caller applies
   * (scaleMeasuredProducedUnits: natcorpScale, embargo haircut, arsenal
   * retention) so the offer is comparable to `balances`. When supplied AND
   * the caller sets `plantsEnabled`, the offered book is built from these
   * units instead of from the revenue nameplate. Null/absent falls back to
   * the legacy revenue-derived offer.
   */
  producedUnits?: number | null;
  /** Share of advertising output available to its audience, default 1. */
  editorialAdvertisingAvailability?: number;
}

/**
 * Per-commodity book-sanity diagnostic emitted by computeClearingFactors.
 * The raw book can legitimately exceed lagged supply because legacy nameplate
 * offers omit ledger-side scale and extraction haircuts. Callers must read
 * mismatch state from invariantBreach (the canonical-basis invariant), not
 * from ad-hoc ratios over rawOfferedUnits. A large post-normalization excess
 * means exempt measured production and the balance ledger are in different
 * units, so fill rates can still be depressed.
 */
export interface ClearingBookDiagnostic {
  commodity: CommodityType;
  /** Country/reachable-market book key, or null for the worldwide book. */
  group: string | null;
  /** Total before legacy nameplate reconciliation. Informational only. */
  rawOfferedUnits: number;
  /** Total after legacy nameplate reconciliation. Use for mismatch alarms. */
  normalizedOfferedUnits: number;
  /** @deprecated Alias of normalizedOfferedUnits for existing consumers. */
  offeredUnits: number;
  /** Legacy/nameplate units before reconciliation. */
  normalizableUnits: number;
  /** Measured produced units exempt from nameplate reconciliation. */
  exemptRealUnits: number;
  laggedSupply: number;
  laggedDemand: number;
  /**
   * True when the post-normalization book breaches the canonical-basis
   * invariant (see isClearingBookBreach). Both sides now build plants units
   * through the canonical basis, so a breach is a genuine defect: the turn
   * keeps clearing honestly and records a health warning.
   */
  invariantBreach: boolean;
}

/**
 * Clearing book invariant (issue #2054): after normalization the offered book
 * and the lagged supply ledger MUST be in one canonical basis. The basis fix
 * (canonicalPlantsUnitsForCommodity on both sides) is what makes them
 * comparable; this predicate is only the backstop that names a residual drift.
 *
 * Two gates, both required. First MATERIALITY: the absolute gap must reach
 * MIN_MATERIAL_BOOK_GAP units. A sub-gap excess cannot move fills or prices:
 * the pinned books run in the thousands, so a gap two orders below that is
 * mix-rounding and scope noise (first landing, new production, sub-scale
 * national books, near-zero denominators), never a defect. Second GROWTH: past
 * the gap, legitimate one-turn growth cannot double an established book
 * (builds land over many turns, the policy output curve caps at +15%), so an
 * excess past 2x is a basis breach, not growth. A material book against a
 * zero (or missing) lagged baseline has an infinite ratio and breaches: that
 * is exactly the pinned pharmaceuticals/ordnance shape, and canonicalization
 * leaves no legitimate way to offer thousands of units the ledger never saw.
 */
export const CLEARING_BOOK_INVARIANT_MIN_MATERIAL_GAP = 250;
export const CLEARING_BOOK_INVARIANT_MAX_GROWTH_FACTOR = 2;

/** Pure predicate behind ClearingBookDiagnostic.invariantBreach. */
export function isClearingBookBreach(
  normalizedOfferedUnits: number,
  laggedSupply: number
): boolean {
  if (!(
    typeof normalizedOfferedUnits === "number" &&
    Number.isFinite(normalizedOfferedUnits) &&
    typeof laggedSupply === "number" &&
    Number.isFinite(laggedSupply)
  )) {
    return false;
  }
  if (normalizedOfferedUnits - laggedSupply < CLEARING_BOOK_INVARIANT_MIN_MATERIAL_GAP) {
    return false;
  }
  if (laggedSupply <= 0) return true;
  return normalizedOfferedUnits > laggedSupply * CLEARING_BOOK_INVARIANT_MAX_GROWTH_FACTOR;
}

/**
 * Deterministic warning text for one breached book. Pure: the same diagnostic
 * always yields the same string, so turn replays and retries cannot duplicate
 * or drop it.
 */
export function describeClearingBookBreach(d: ClearingBookDiagnostic): string {
  const book = d.group ? d.commodity + "@" + d.group : d.commodity;
  const ratio =
    d.laggedSupply > 0 ? d.normalizedOfferedUnits / d.laggedSupply : Number.POSITIVE_INFINITY;
  return (
    "clearing invariant breach on " +
    book +
    ": normalized " +
    Math.round(d.normalizedOfferedUnits) +
    " vs lagged supply " +
    Math.round(d.laggedSupply) +
    " (" +
    (Number.isFinite(ratio) ? ratio.toFixed(1) : "inf") +
    "x; raw " +
    Math.round(d.rawOfferedUnits) +
    ")"
  );
}

export interface SectorClearingResult {
  /** Normalized share of each scoped offer book, for allocating shortage headroom once. */
  marketSupplyShareByCommodity?: Partial<Record<CommodityType, number>>;
  /** Weighted legFactor across outputs (unramped). */
  factor: number;
  /** Weighted sold fraction across outputs. */
  soldFraction: number;
  /**
   * Sold fraction per output commodity, before the rate-weighted rollup above.
   * A multi-output sector (oil_gas: oil 0.58 + natural_gas 0.32) can sell one
   * output out completely and the other barely at all; the weighted headline
   * hides that, and players read the blended number as "my short commodity
   * isn't selling". The sector page renders these per output.
   *
   * Optional so callers that hand-build a result (tests, fixtures) need not
   * restate it; computeClearingFactors always populates it.
   */
  soldByCommodity?: Partial<Record<CommodityType, number>>;
  /**
   * Offered fraction buyers took but a media ownership law refused, overall
   * and per output. Not sold and not paid; production feedback counts it as
   * demand so a capped outlet does not shrink because of a legal limit.
   * Absent when nothing was blocked.
   */
  regulationBlockedFraction?: number;
  regulationBlockedByCommodity?: Partial<Record<CommodityType, number>>;
  /** Exact normalized units delivered, emitted only when recording is enabled. */
  deliveredUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  /** Posture actually used (player's, or the auto value). */
  effectivePosture: number;
  /** Exact quoted offer factor per output, before sold quantity is applied. */
  offerFactorByCommodity?: Partial<Record<CommodityType, number>>;
  /**
   * Each output's share of the sector's realized revenue this pass (weight x
   * sold x offer factor, normalized to sum to 1). Telemetry only: the money
   * path still uses the blended `factor`. The sector page uses it to split
   * the blended "sold at" price into a sale price per product, which matters
   * when outputs are priced far apart (ordnance vs. industrial chemicals).
   * Absent when nothing sold.
   */
  revenueShareByCommodity?: Partial<Record<CommodityType, number>>;
  /** Project-owned offer identity and units, carried through commodity clearing. */
  productProjectId?: string;
  productOutputTurn?: number;
  projectOutputUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  projectSoldUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  projectQualityByCommodity?: Partial<Record<CommodityType, number>>;
}

/**
 * Run the clearing pass across every selling sector for every commodity.
 * Pure: consumes lagged balances/prices, returns per-sector factors.
 */
export function computeClearingFactors(args: {
  sectors: readonly SectorClearingInput[];
  /** Optional own-group supply policy, inert when omitted. */
  internalSupply?: InternalSupplyClearing;
  /** Enabled ownership laws constrain actual advertising fills before receipts. */
  mediaOwnership?: MediaOwnershipMarket;
  recordDelivery?: boolean;
  /** NPP-only internal allocations; absent leaves legacy clearing unchanged. */
  groupSupply?: {
    turn: number;
    activeRoots?: ReadonlySet<string>;
    localInputAvailabilityByState?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
    localBalancesByState?: ReadonlyMap<string, ReadonlyMap<CommodityType, { demand: number }>>;
    forecastByRoot?: Map<string, GroupForecastBasis>;
    freightSettlementActive: boolean;
    members: readonly SupplyMember[];
    buyersByCommodity: ReadonlyMap<CommodityType, readonly CoordinationBuyer[]>;
    locationBySector: ReadonlyMap<string, { countryId: string; stateId: string }>;
    physicalBySectorCommodity: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
    receipts: GroupMarketReceipt[];
    committedOutputBySector?: Map<string, Map<string, number>>;
    availabilityBySector: Map<string, Map<CommodityType, number>>;
    inputAllocationsBySector?: Map<
      string,
      Map<
        CommodityType,
        import("@/lib/corporations/groups/rules/inputPricing").GroupInputAllocation
      >
    >;
  };
  /** Lagged per-commodity aggregate balances (prior turn). */
  balances: ReadonlyMap<CommodityType, { supply: number; demand: number }>;
  /** Lagged price-over-base ratios (prior turn). */
  priceRatioByCommodity: ReadonlyMap<CommodityType, number>;
  basePrices: Record<CommodityType, number>;
  /** Optional book-sanity hook — called once per cleared commodity. */
  onBookDiagnostic?: (d: ClearingBookDiagnostic) => void;
  /**
   * Commodities whose lagged price row was written by a prior market turn.
   * A reset seeds turn-0 price rows with zero supply/demand; comparing a new
   * producer against that placeholder is not a supply-ledger invariant check.
   * Omitted by standalone callers to retain the existing comparison behavior.
   */
  initializedLaggedBooks?: ReadonlySet<CommodityType>;
  /**
   * Brand-loyalty slice (A2b, brandLoyaltySliceEnabled). When true, each
   * commodity runs a loyal-slice pre-pass off sectors' `brandLoyalty` before
   * cheapest-first. Omitted/false ⇒ clearing is byte-identical to today.
   */
  loyaltySliceEnabled?: boolean;
  /**
   * Private supply agreements (supplyAgreementsEnabled). Per supplier corp, the
   * contracted output units per scope key. computeClearingFactors distributes
   * each corp's contracted volume across its selling sectors for that commodity
   * and guarantees their fill before loyalty/cheapest-first.
   *
   * Keys are {@link supplyAgreementScopeKey}: a bare commodity is a
   * corporation-wide reservation split across every book the corp sells in;
   * `commodity@stateId` is a state-scoped reservation that lands only in that
   * state's book, on that state's sectors.
   */
  contractedByCorpCommodity?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** sectorId → owning corpId, required to resolve contracts to sectors. */
  sectorCorpId?: ReadonlyMap<string, string>;
  /**
   * Optional settlement sink: supplier corpId → scope key → contracted units
   * that ACTUALLY cleared this pass. The caller uses it to settle the bilateral
   * price premium (a contract-for-difference) as a separate cash transfer, so
   * the revenue/tax/share-price legs stay untouched. Keyed exactly like
   * `contractedByCorpCommodity`.
   */
  contractSettlementOut?: Map<string, Map<string, number>>;
  /**
   * Optional production sink: supplier corpId → commodity → the units that corp
   * actually OFFERED this pass (under plants, its real produced units for that
   * commodity). The settlement pass uses it to tell a delivery shortfall caused
   * by under-production — the seller's fault, penalised — apart from one caused
   * by weak market demand, which is nobody's breach. Requires `sectorCorpId`.
   */
  producedUnitsOut?: Map<string, Map<CommodityType, number>>;
  /**
   * Quality → premium coupling (qualityPremiumPricingEnabled). When true, each
   * sector's `outputQuality` scales the premium portion of a positive posture
   * in the revenue leg. Omitted/false ⇒ the revenue leg is byte-identical.
   */
  qualityPremiumEnabled?: boolean;
  /**
   * Plants tier: sellers offer their measured `producedUnits` (split across the
   * output mix) rather than revenue-derived nameplate units. Omitted/false ⇒
   * the book is byte-identical to today for every other mode.
   */
  plantsEnabled?: boolean;
  /**
   * Market partition (era worlds, marketPartition): sectorId → market-group key
   * (the seller's home country). Together with `balancesByGroup`, each
   * commodity clears one book PER GROUP against that group's reachable
   * balances (see market/tradePartition.ts) instead of a single worldwide
   * book — a seller behind an embargo wall competes only for the demand its
   * country can reach. Sectors absent from the map, or groups without a
   * balance entry, fall back to the worldwide `balances`. Omitted ⇒ one
   * worldwide book, byte-identical to today.
   */
  groupBySector?: ReadonlyMap<string, string>;
  /** Per-group lagged balances (group key → commodity → {supply, demand}). */
  balancesByGroup?: ReadonlyMap<
    string,
    ReadonlyMap<CommodityType, { supply: number; demand: number }>
  >;
  /**
   * Per-group lagged price-over-base ratios (group key → commodity → ratio).
   * When partitioned, a seller's price-realization leg reads its own market's
   * reachable price, not the worldwide `priceRatioByCommodity` — otherwise a
   * seller in a locally-short, globally-glutted market realizes glut revenue
   * on shortage volume. Groups/commodities absent here fall back to the
   * worldwide ratio, so the map may be sparse.
   */
  priceRatioByGroup?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  /**
   * State-local market context. Omit the whole context to preserve the legacy
   * reachable-book behavior, for example while a legacy freight supply
   * agreement still requires corporation-wide settlement. Once present, a
   * state-local seller with missing location data fails closed into a zero-
   * demand book rather than claiming aggregate demand already used elsewhere.
   */
  /**
   * Revenue-follows-placement phase-in progress, 0..1 (see
   * market/placementRevenuePhase). 0 or absent keeps the sold fraction
   * measured against the placement-shrunk offer, as before.
   */
  placementRevenuePhase?: number;
  stateMarkets?: {
    /** sectorId → host stateId. */
    stateBySector: ReadonlyMap<string, string>;
    /** stateId → commodity → lagged supply and demand. */
    balances: ReadonlyMap<string, ReadonlyMap<CommodityType, { supply: number; demand: number }>>;
    /** stateId → commodity → lagged price-over-base ratio. */
    priceRatios: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  };
}): Map<string, SectorClearingResult> {
  const { sectors, balances, priceRatioByCommodity, basePrices, onBookDiagnostic } = args;

  // States and countries share an id space (DE is both Delaware and Germany),
  // so a state book gets a namespaced group key that cannot collide with a
  // country group.
  const stateGroupKey = (stateId: string) => `${STATE_GROUP_PREFIX}${stateId}`;
  /** The seller's known state when this commodity clears state-locally. */
  const stateScopeFor = (commodity: CommodityType, sectorId: string): string | null => {
    if (!args.stateMarkets || !isStateScopedCommodity(commodity)) return null;
    return args.stateMarkets.stateBySector.get(sectorId) ?? null;
  };
  const bookKeyFor = (commodity: CommodityType, sectorId: string): string => {
    const stateId = stateScopeFor(commodity, sectorId);
    if (stateId != null) return stateGroupKey(stateId);
    if (args.stateMarkets && isStateScopedCommodity(commodity)) {
      return `${MISSING_STATE_GROUP_PREFIX}${sectorId}`;
    }
    return args.groupBySector?.get(sectorId) ?? "";
  };
  const balanceForBook = (book: string, commodity: CommodityType) => {
    if (book.startsWith(STATE_GROUP_PREFIX)) {
      return args.stateMarkets?.balances.get(book.slice(STATE_GROUP_PREFIX.length))?.get(commodity);
    }
    if (book.startsWith(MISSING_STATE_GROUP_PREFIX)) return undefined;
    return (
      (book !== "" ? args.balancesByGroup?.get(book)?.get(commodity) : undefined) ??
      balances.get(commodity)
    );
  };
  const realizedPriceFor = (commodity: CommodityType, sectorId: string) => {
    const stateScope = stateScopeFor(commodity, sectorId);
    const group = args.groupBySector?.get(sectorId);
    return priceRealizationFactor(
      (stateScope != null
        ? args.stateMarkets?.priceRatios.get(stateScope)?.get(commodity)
        : undefined) ??
        (group != null ? args.priceRatioByGroup?.get(group)?.get(commodity) : undefined) ??
        priceRatioByCommodity.get(commodity)
    );
  };

  // Loyal-slice lookup (seller id === sectorId), built only when the slice is on.
  const loyaltyBySectorId = args.loyaltySliceEnabled
    ? new Map<string, number>(sectors.map((s) => [s.sectorId, Math.max(0, s.brandLoyalty ?? 0)]))
    : undefined;

  // 1) Resolve each sector's effective posture + offered units per commodity.
  const sellersByCommodity = new Map<CommodityType, ClearingSeller[]>();
  const postureBySector = new Map<string, number>();
  const sourceBySector = new Map(sectors.map((s) => [s.sectorId, s]));
  const groupFractionByCommodity = new Map<CommodityType, Map<string, number>>();
  const groupCash = new Map(
    args.groupSupply?.members.map((m) => [m.id, m.cashAvailableAnchor]) ?? []
  );
  for (const s of sectors) {
    const commodities = new Set([
      ...Object.keys(s.supplyRates),
      ...Object.keys(s.outputUnitsByCommodity ?? {}),
    ] as CommodityType[]);
    for (const commodity of commodities) {
      const rate = s.supplyRates[commodity] ?? 0;
      const hasExactProductOffer = s.outputUnitsByCommodity != null;
      const productUnits = s.outputUnitsByCommodity?.[commodity];
      if (hasExactProductOffer && productUnits == null) continue;
      if (rate <= 0 && productUnits == null) continue;
      // Auto-posture reads the sector's OWN market's balance when partitioned:
      // a seller in a glutted, embargo-walled market must undercut off its
      // reachable book, not off a healthy worldwide aggregate it cannot sell to.
      // Under state scoping that book is its own state, so a logistics sector
      // in a glutted state undercuts even while the nation looks balanced.
      const bal = balanceForBook(bookKeyFor(commodity, s.sectorId), commodity);
      const posture =
        s.posture != null
          ? clampPricingPosture(s.posture)
          : autoPosture(bal?.demand ?? 0, bal?.supply ?? 0, s.lastSoldFraction);
      postureBySector.set(s.sectorId, posture);
      // Naive nameplate units from revenue. This OVERSTATES a sector's actual
      // output: the supply ledger (computeRawSupplyDemand) applies natcorpScale,
      // outputMultiplier and the extraction capacity haircut on top of the same
      // revenue/base term, so nameplate/base > the units that actually reach the
      // market. The excess is reconciled per-commodity in section 2 by normalizing
      // the book down to the lagged supply (which already carries those factors).
      const base = basePrices[commodity];
      // Plants: the seller offers what its plants MADE last turn, split across
      // the output mix by the same rate/base weights the nameplate uses — so
      // the split is unchanged and only the total is replaced. This is a real
      // measured quantity, not a revenue proxy, which is why it skips the
      // lagged-supply reconciliation in section 2.
      const plantsUnits =
        args.plantsEnabled && hasExactProductOffer && typeof productUnits === "number"
          ? Math.max(0, productUnits)
          : args.plantsEnabled && typeof s.producedUnits === "number" && s.producedUnits >= 0
            ? s.producedUnits * mixWeight(s.supplyRates, basePrices, commodity)
            : null;
      const physicalUnits = plantsUnits ?? (base > 0 ? (s.revenue * rate) / base : 0);
      const editorialAvailability =
        commodity === "advertising" && Number.isFinite(s.editorialAdvertisingAvailability)
          ? Math.max(0, Math.min(1, s.editorialAdvertisingAvailability!))
          : 1;
      const productAvailability = Number.isFinite(s.offerAvailabilityByCommodity?.[commodity])
        ? Math.max(0, Math.min(1, s.offerAvailabilityByCommodity?.[commodity] ?? 1))
        : 1;
      const availability = editorialAvailability * productAvailability;
      const placement = s.offerPlacementByCommodity?.[commodity] ?? 1;
      const units = physicalUnits * availability * placement;
      if (
        units <= 0 &&
        !Number.isFinite(s.offerAvailabilityByCommodity?.[commodity]) &&
        !Number.isFinite(s.offerPlacementByCommodity?.[commodity])
      )
        continue;
      sellersByCommodity.set(commodity, [
        ...(sellersByCommodity.get(commodity) ?? []),
        {
          id: s.sectorId,
          units,
          physicalUnits,
          editorialAvailability,
          productAvailability,
          availability,
          posture,
          realUnits: plantsUnits != null,
          ...(s.inputCostIndex !== undefined
            ? {
                quotedPosture:
                  costPlusPriceFactor(
                    s.inputCostIndex,
                    posture,
                    s.inputCostShare,
                    s.fixedCostShare
                  ) /
                    realizedPriceFor(commodity, s.sectorId) -
                  1,
              }
            : {}),
        },
      ]);
    }
  }

  // 2) Clear each commodity market against LAGGED demand. Sellers outside this
  //    pass (unowned pools, imports) are represented by the gap between the
  //    lagged aggregate supply and the units offered here: demand available to
  //    these sellers is scaled by their share of total supply so the pass
  //    doesn't hand corporate sectors the whole market.
  const soldByCommodityBySector = new Map<CommodityType, Map<string, number>>();
  const supplyShareByCommodity = new Map<CommodityType, Map<string, number>>();
  const deliveredByCommodityBySector = new Map<CommodityType, Map<string, number>>();
  // Offered fraction a buyer took but an ownership law refused, kept apart
  // from sold so production feedback does not read a legal limit as no demand.
  const regulationBlockedByCommodityBySector = new Map<CommodityType, Map<string, number>>();
  for (const [commodity, sellers] of args.groupSupply
    ? [...sellersByCommodity].sort(([a], [b]) => a.localeCompare(b))
    : sellersByCommodity) {
    // Market partition: split the commodity's sellers into per-group books
    // (seller's home country) and clear each book against ITS reachable
    // balances. Without partition args this is one worldwide group ("") over
    // the aggregate `balances` — the original single-book pass, unchanged.
    const partitioned = new Map<string, ClearingSeller[]>();
    if (args.balancesByGroup || args.stateMarkets) {
      for (const s of sellers) {
        const g = bookKeyFor(commodity, s.id);
        partitioned.set(g, [...(partitioned.get(g) ?? []), s]);
      }
    } else {
      partitioned.set("", sellers);
    }

    for (const [g, groupSellers] of partitioned) {
      const bal = balanceForBook(g, commodity);
      const rawOfferedUnits = groupSellers.reduce((sum, s) => sum + s.units, 0);
      const laggedSupply = bal?.supply ?? 0;
      const normalizable = groupSellers.filter((s) => !s.realUnits);
      const normalizableUnits = normalizable.reduce((sum, s) => sum + s.units, 0);
      const exemptRealUnits = rawOfferedUnits - normalizableUnits;
      // When the nameplate exceeds lagged supply, scale every seller down
      // proportionally so the offered book equals the units that actually reach the
      // market. This makes aggregate corp fill track the true clear rate
      // (min(1, demand/supply)) instead of being depressed by phantom over-supply,
      // while preserving relative seller shares so posture ordering still holds.
      // Sellers offering REAL produced units are exempt: the normalization exists
      // only to undo the nameplate's known overstatement (it omits natcorpScale,
      // outputMultiplier and the extraction haircut that the supply ledger
      // applies). Capacity-derived offers already carry every production leg, so
      // scaling them down would double-count the same haircuts and depress fills.
      if (laggedSupply > 0 && rawOfferedUnits > laggedSupply) {
        const target = laggedSupply - exemptRealUnits;
        if (normalizableUnits > 0 && target > 0 && target < normalizableUnits) {
          const norm = target / normalizableUnits;
          for (const s of normalizable) s.units *= norm;
        } else if (normalizableUnits > 0 && target <= 0) {
          // Exempt (real) offers alone already meet or exceed lagged supply —
          // nothing left of the book for the nameplate sellers to claim.
          for (const s of normalizable) s.units = 0;
        }
      }
      const normalizedOfferedUnits = groupSellers.reduce((sum, s) => sum + s.units, 0);
      const shares = supplyShareByCommodity.get(commodity) ?? new Map<string, number>();
      for (const seller of groupSellers) {
        shares.set(
          seller.id,
          normalizedOfferShare(seller.units, normalizedOfferedUnits, laggedSupply)
        );
      }
      supplyShareByCommodity.set(commodity, shares);
      onBookDiagnostic?.({
        commodity,
        group: g || null,
        rawOfferedUnits,
        normalizedOfferedUnits,
        offeredUnits: normalizedOfferedUnits,
        normalizableUnits,
        exemptRealUnits,
        laggedSupply,
        laggedDemand: bal?.demand ?? 0,
        invariantBreach:
          (args.initializedLaggedBooks?.has(commodity) ?? true) &&
          isClearingBookBreach(normalizedOfferedUnits, laggedSupply),
      });
    }

    // Post-normalization per-corp unit totals ACROSS groups: a corp whose
    // sectors span countries (overseas plants) must have its contracted volume
    // split once, proportional to where its units actually sit — allocating the
    // full volume inside every book it touches would double-count the contract.
    const corpUnitsTotal = new Map<string, number>();
    if (args.contractedByCorpCommodity && args.sectorCorpId) {
      for (const s of sellers) {
        const corpId = args.sectorCorpId.get(s.id);
        if (!corpId) continue;
        corpUnitsTotal.set(corpId, (corpUnitsTotal.get(corpId) ?? 0) + s.units);
      }
    }

    const sold = new Map<string, number>();
    const contractedCorpBySector = new Map<string, string>();
    const contractedShareBySector = new Map<string, number>();
    // Which reservation(s) a sector's contracted share came from, so the
    // settlement sink can credit a state contract and a corporation-wide one
    // separately. Shares sum to `contractedShareBySector`.
    const contractedKeysBySector = new Map<string, Array<{ key: string; share: number }>>();
    // Each seller's slice of its book's demand, the audience an ownership law
    // measures against.
    const demandSliceBySector = new Map<string, number>();
    for (const [g, groupSellers] of partitioned) {
      const bal = balanceForBook(g, commodity);
      const laggedSupply = bal?.supply ?? 0;
      const offeredUnits = groupSellers.reduce((sum, s) => sum + s.units, 0);
      const totalSupply = Math.max(laggedSupply, offeredUnits);
      const share = totalSupply > 0 ? offeredUnits / totalSupply : 1;
      const demandForPass = (bal?.demand ?? 0) * share;
      for (const s of groupSellers)
        demandSliceBySector.set(
          s.id,
          offeredUnits > 0 ? (demandForPass * s.units) / offeredUnits : 0
        );

      // Contracted allocation: distribute each supplier corp's contracted volume
      // for this commodity across its selling sectors, proportional to their
      // (post-normalization) offered units, capped at each sector's units. This
      // is a RESERVATION, not a ceiling: the contracted units are guaranteed-sold
      // to the buyer, and the sector's surplus above them still clears openly.
      let contractedUnitsById: Map<string, number> | undefined;
      if (args.contractedByCorpCommodity && args.sectorCorpId) {
        contractedUnitsById = new Map<string, number>();
        // A state book also carries the state-scoped reservations addressed to
        // it. Those are whole, not sliced by unit weight: the contract named
        // this state, so its plants here are the only ones that can fill it.
        const bookStateId = g.startsWith(STATE_GROUP_PREFIX)
          ? g.slice(STATE_GROUP_PREFIX.length)
          : null;
        const stateKey =
          bookStateId != null ? supplyAgreementScopeKey(commodity, bookStateId) : null;
        const unitsByCorp = new Map<string, { total: number; sellers: ClearingSeller[] }>();
        for (const s of groupSellers) {
          const corpId = args.sectorCorpId.get(s.id);
          if (!corpId) continue;
          const e = unitsByCorp.get(corpId) ?? { total: 0, sellers: [] };
          e.total += s.units;
          e.sellers.push(s);
          unitsByCorp.set(corpId, e);
        }
        for (const [corpId, e] of unitsByCorp) {
          const byKey = args.contractedByCorpCommodity.get(corpId);
          const contractedAll = byKey?.get(commodity) ?? 0;
          const allUnits = corpUnitsTotal.get(corpId) ?? 0;
          // This group's slice of the corp's corporation-wide volume, by unit weight.
          const wide = allUnits > 0 ? contractedAll * (e.total / allUnits) : 0;
          const stateContracted = stateKey != null ? (byKey?.get(stateKey) ?? 0) : 0;
          const contracted = Math.max(0, wide) + Math.max(0, stateContracted);
          if (contracted <= 0 || e.total <= 0) continue;
          const take = Math.min(contracted, e.total);
          // Both reservations shrink together when the book cannot cover them.
          const fillRatio = take / contracted;
          for (const s of e.sellers) {
            const sectorShare = (take * s.units) / e.total;
            contractedUnitsById.set(s.id, sectorShare);
            contractedCorpBySector.set(s.id, corpId);
            contractedShareBySector.set(s.id, sectorShare);
            const keys: Array<{ key: string; share: number }> = [];
            if (wide > 0)
              keys.push({ key: commodity, share: (wide * fillRatio * s.units) / e.total });
            if (stateContracted > 0 && stateKey != null) {
              keys.push({
                key: stateKey,
                share: (stateContracted * fillRatio * s.units) / e.total,
              });
            }
            contractedKeysBySector.set(s.id, keys);
          }
        }
      }

      // Existing agreements take precedence. Group allocations consume the same
      // finite offers and anonymous demand, and carry no premium or damages.
      const groupContext = args.groupSupply;
      const groupReserved = new Map<string, number>();
      let groupUnits = 0;
      if (groupContext && args.sectorCorpId && commodity !== "advertising") {
        const buyers = (groupContext.buyersByCommodity.get(commodity) ?? []).filter(
          (b) => bookKeyFor(commodity, b.sectorId) === g
        );
        const price =
          (basePrices[commodity] * realizedPriceFor(commodity, groupSellers[0]?.id ?? "")) /
          TURNS_PER_DAY;
        const allSellers = groupSellers.map((s) => ({
          sectorId: s.id,
          memberId: args.sectorCorpId!.get(s.id) ?? "",
          countryId: groupContext.locationBySector.get(s.id)?.countryId ?? "",
          stateId: groupContext.locationBySector.get(s.id)?.stateId ?? "",
          units: s.units,
          committedUnits: contractedUnitsById?.get(s.id) ?? 0,
          physicalUnits: groupContext.physicalBySectorCommodity.get(s.id)?.get(commodity) ?? 0,
        }));
        if (groupContext.committedOutputBySector)
          for (const seller of allSellers) {
            const row =
              groupContext.committedOutputBySector?.get(seller.sectorId) ??
              new Map<string, number>();
            row.set(commodity, seller.committedUnits);
            groupContext.committedOutputBySector?.set(seller.sectorId, row);
          }
        const baselineFill = groupContext.forecastByRoot
          ? clearCommodityMarket(
              demandForPass,
              groupSellers,
              loyaltyBySectorId,
              contractedUnitsById
            )
          : new Map<string, number>();
        for (const [rootId, basis] of groupContext.forecastByRoot ?? []) {
          const ownSellers = allSellers.filter((s) => basis.memberIds.includes(s.memberId));
          const ownBuyers = buyers.filter((b) => basis.memberIds.includes(b.memberId));
          if (!ownSellers.length && !ownBuyers.length) continue;
          if (
            basis.books.length >= 128 ||
            basis.books.reduce((n, b) => n + b.sellers.length + b.buyers.length, 0) +
              ownSellers.length +
              ownBuyers.length >
              2000
          ) {
            basis.complete = false;
            continue;
          }
          const preview = {
            commodity,
            supply: bal?.supply ?? 0,
            demand: bal?.demand ?? 0,
            unitPriceAnchor: price,
            benchmarkFactor: realizedPriceFor(commodity, groupSellers[0]?.id ?? ""),
            freightSettlementActive: groupContext.freightSettlementActive,
            buyers: ownBuyers,
            sellers: ownSellers.map((s) => {
              return {
                ...s,
                openFill:
                  s.units > s.committedUnits
                    ? Math.max(
                        0,
                        (s.units * (baselineFill.get(s.sectorId) ?? 0) - s.committedUnits) /
                          (s.units - s.committedUnits)
                      )
                    : 0,
                quoteFactor:
                  offerPriceFactor({
                    posture: postureBySector.get(s.sectorId) ?? 0,
                    priceLeg: realizedPriceFor(commodity, s.sectorId),
                    qualityPremiumEnabled: args.qualityPremiumEnabled,
                    quality:
                      sourceBySector.get(s.sectorId)?.productQualityByCommodity?.[commodity] ??
                      sourceBySector.get(s.sectorId)?.outputQuality,
                    inputCostIndex: sourceBySector.get(s.sectorId)?.inputCostIndex,
                    inputCostShare: sourceBySector.get(s.sectorId)?.inputCostShare,
                    fixedCostShare: sourceBySector.get(s.sectorId)?.fixedCostShare,
                  }) / realizedPriceFor(commodity, s.sectorId),
              };
            }),
          };
          for (const slice of coordinationSlices(
            { ...preview, turn: groupContext.turn, members: groupContext.members },
            groupContext.localInputAvailabilityByState,
            groupContext.localBalancesByState
          )) {
            const rows = slice.sellers.length + slice.buyers.length;
            if (
              basis.books.length >= 128 ||
              basis.books.reduce((n, b) => n + b.sellers.length + b.buyers.length, 0) + rows > 2000
            ) {
              basis.complete = false;
              break;
            }
            basis.books.push({
              ...preview,
              supply: slice.supply,
              demand: slice.demand,
              buyers: slice.buyers,
              sellers: preview.sellers.filter((s) =>
                slice.sellers.some((r) => r.sectorId === s.sectorId)
              ),
            });
          }
          if (rootId !== basis.rootId) basis.complete = false;
        }
        const allocation = coordinateGroupMarket(
          {
            commodity,
            turn: groupContext.turn,
            supply: bal?.supply ?? 0,
            demand: bal?.demand ?? 0,
            unitPriceAnchor: price,
            freightSettlementActive: groupContext.freightSettlementActive,
            members: groupContext.members
              .filter((m) => !groupContext.activeRoots || groupContext.activeRoots.has(m.rootId))
              .map((m) => ({
                ...m,
                cashAvailableAnchor: groupCash.get(m.id) ?? 0,
              })),
            buyers,
            sellers: allSellers,
          },
          groupContext.localInputAvailabilityByState,
          groupContext.localBalancesByState
        );
        for (const [id, units] of allocation.reservedBySeller) {
          groupReserved.set(id, units);
          groupUnits += units;
          const seller = groupSellers.find((s) => s.id === id)!;
          const fractions = groupFractionByCommodity.get(commodity) ?? new Map<string, number>();
          fractions.set(id, seller.units > 0 ? units / seller.units : 0);
          groupFractionByCommodity.set(commodity, fractions);
        }
        for (const [id, amount] of allocation.spendByBuyer)
          groupCash.set(id, Math.max(0, (groupCash.get(id) ?? 0) - amount));
        for (const [id, availability] of allocation.availabilityByBuyer) {
          const byCommodity =
            groupContext.availabilityBySector.get(id) ?? new Map<CommodityType, number>();
          byCommodity.set(commodity, availability);
          groupContext.availabilityBySector.set(id, byCommodity);
        }
        for (const receipt of allocation.receipts) {
          if (!groupContext.inputAllocationsBySector) continue;
          const byCommodity =
            groupContext.inputAllocationsBySector.get(receipt.buyerSectorId) ?? new Map();
          const prev = byCommodity.get(commodity);
          const units =
            (receipt.units * basePrices[commodity]) /
            COMMODITY_BASE_PRICES[commodity] /
            TURNS_PER_DAY;
          byCommodity.set(commodity, {
            units: (prev?.units ?? 0) + units,
            marketFactor: realizedPriceFor(commodity, receipt.supplierSectorId),
          });
          groupContext.inputAllocationsBySector.set(receipt.buyerSectorId, byCommodity);
        }
        groupContext.receipts.push(...allocation.receipts);
      }
      const internalReservations =
        args.internalSupply && !args.groupSupply && args.sectorCorpId
          ? reserveInternalSupply({
              context: args.internalSupply,
              commodity,
              sellers: groupSellers,
              corporationBySector: args.sectorCorpId,
              committed: contractedUnitsById,
              book: g,
              bookForSector: (id) => bookKeyFor(commodity, id),
              supply: Math.min(laggedSupply, offeredUnits),
              demand: bal?.demand ?? 0,
              reservationRoom: Math.max(
                0,
                demandForPass -
                  [...(contractedUnitsById?.values() ?? [])].reduce((n, u) => n + u, 0)
              ),
              marketPrice:
                basePrices[commodity] * realizedPriceFor(commodity, groupSellers[0]?.id ?? ""),
            })
          : undefined;
      const groupSold = clearCommodityMarket(
        Math.max(0, demandForPass - groupUnits),
        groupSellers.map((s) => ({
          ...s,
          units: Math.max(0, s.units - (groupReserved.get(s.id) ?? 0)),
        })),
        loyaltyBySectorId,
        internalReservations ?? contractedUnitsById
      );
      for (const seller of groupSellers) {
        const reserved = groupReserved.get(seller.id) ?? 0;
        if (reserved > 0)
          groupSold.set(
            seller.id,
            Math.min(
              1,
              (reserved + (seller.units - reserved) * (groupSold.get(seller.id) ?? 0)) /
                seller.units
            )
          );
      }
      for (const [id, f] of groupSold) sold.set(id, f);
    }
    if (commodity === "advertising" && args.mediaOwnership) {
      const rows = sellers.flatMap((seller) => {
        const stateId = args.mediaOwnership!.stateBySector.get(seller.id);
        const corporationId = args.mediaOwnership!.corporationBySector.get(seller.id);
        return stateId && corporationId
          ? [
              {
                sectorId: seller.id,
                stateId,
                corporationId,
                units: seller.units * (sold.get(seller.id) ?? 0),
                demandUnits: demandSliceBySector.get(seller.id) ?? 0,
              },
            ]
          : [];
      });
      const capped = capDeliveredMediaUnits(
        rows,
        args.mediaOwnership.shareCap,
        args.mediaOwnership.demandByState,
        args.mediaOwnership.limitUnitsByOwner
      );
      const blocked = new Map<string, number>();
      for (const seller of sellers) {
        const units = capped.get(seller.id);
        if (units === undefined) continue;
        const before = sold.get(seller.id) ?? 0;
        const after = seller.units > 0 ? units / seller.units : 0;
        sold.set(seller.id, after);
        if (before - after > 0) blocked.set(seller.id, before - after);
      }
      regulationBlockedByCommodityBySector.set(commodity, blocked);
    }
    if (args.internalSupply && !args.groupSupply)
      finishInternalSupplyCommodity(
        args.internalSupply,
        commodity,
        sold,
        sellers,
        contractedShareBySector,
        regulationBlockedByCommodityBySector.get(commodity)
      );
    soldByCommodityBySector.set(commodity, sold);
    if (args.recordDelivery)
      deliveredByCommodityBySector.set(
        commodity,
        new Map(sellers.map((seller) => [seller.id, seller.units * (sold.get(seller.id) ?? 0)]))
      );

    // Production sink: each corp's offered units for this commodity, recorded
    // BEFORE any fill outcome. Under plants these are real produced units.
    if (args.producedUnitsOut && args.sectorCorpId) {
      for (const s of sellers) {
        const corpId = args.sectorCorpId.get(s.id);
        const available = s.availability ?? s.editorialAvailability ?? 1;
        const productionUnits =
          s.realUnits === true
            ? (s.physicalUnits ?? s.units)
            : available < 1
              ? s.units / available
              : s.units;
        if (!corpId || !(productionUnits > 0)) continue;
        const byCommodity = args.producedUnitsOut.get(corpId) ?? new Map<CommodityType, number>();
        byCommodity.set(commodity, (byCommodity.get(commodity) ?? 0) + productionUnits);
        args.producedUnitsOut.set(corpId, byCommodity);
      }
    }

    // Settlement sink: record the contracted units that actually cleared, per
    // supplier corp, for the caller's bilateral premium settlement.
    if (args.contractSettlementOut && contractedShareBySector.size > 0) {
      for (const [sectorId, contractedShare] of contractedShareBySector) {
        const corpId = contractedCorpBySector.get(sectorId);
        if (!corpId) continue;
        const seller = sellers.find((x) => x.id === sectorId);
        const filledFraction = sold.get(sectorId) ?? 0;
        const filledUnits = seller ? Math.min(contractedShare, filledFraction * seller.units) : 0;
        if (filledUnits <= 0) continue;
        const byKey = args.contractSettlementOut.get(corpId) ?? new Map<string, number>();
        // Credit each reservation its share of what actually filled.
        const keys = contractedKeysBySector.get(sectorId) ?? [
          { key: commodity, share: contractedShare },
        ];
        for (const { key, share } of keys) {
          if (!(share > 0)) continue;
          const credited = filledUnits * (share / contractedShare);
          byKey.set(key, (byKey.get(key) ?? 0) + credited);
        }
        args.contractSettlementOut.set(corpId, byKey);
      }
    }
  }

  // 3) Weighted per-sector factor across outputs.
  const internalUnitsByCommodity = new Map<CommodityType, Map<string, number>>();
  for (const trade of (args.groupSupply ? [] : args.internalSupply?.tradesOut) ?? []) {
    const units = internalUnitsByCommodity.get(trade.commodity) ?? new Map<string, number>();
    units.set(trade.supplierSectorId, (units.get(trade.supplierSectorId) ?? 0) + trade.units);
    internalUnitsByCommodity.set(trade.commodity, units);
  }
  const offeredUnitsByCommodity = new Map(
    [...internalUnitsByCommodity.keys()].map((commodity) => [
      commodity,
      new Map((sellersByCommodity.get(commodity) ?? []).map((seller) => [seller.id, seller.units])),
    ])
  );
  const results = new Map<string, SectorClearingResult>();
  for (const s of sectors) {
    let rateSum = 0;
    let factorSum = 0;
    let soldSum = 0;
    let quotedPostureSum = 0;
    const posture = postureBySector.get(s.sectorId) ?? 0;
    // Quality → premium: only a positive (premium) posture is quality-scaled,
    // and only when the caller opted in with a finite quality. The base price
    // and any undercut are untouched, so quality can lift or shave the premium
    // but never let a seller charge below market.
    const soldByCommodity: Partial<Record<CommodityType, number>> = {};
    const marketSupplyShareByCommodity: Partial<Record<CommodityType, number>> = {};
    const deliveredUnitsByCommodity: Partial<Record<CommodityType, number>> = {};
    const offerFactorByCommodity: Partial<Record<CommodityType, number>> = {};
    const revenueWeightByCommodity: Partial<Record<CommodityType, number>> = {};
    const regulationBlockedByCommodity: Partial<Record<CommodityType, number>> = {};
    let blockedSum = 0;
    const sectorGroup = args.groupBySector?.get(s.sectorId);
    const groupRatios = sectorGroup != null ? args.priceRatioByGroup?.get(sectorGroup) : undefined;
    const outputCommodities = new Set([
      ...Object.keys(s.supplyRates),
      ...Object.keys(s.outputAnchorByCommodity ?? {}),
      ...Object.keys(s.outputUnitsByCommodity ?? {}),
      ...Object.keys(s.projectOutputUnitsByCommodity ?? {}),
    ] as CommodityType[]);
    for (const commodity of outputCommodities) {
      const rate = s.supplyRates[commodity] ?? 0;
      const outputAnchor = s.outputAnchorByCommodity?.[commodity];
      const weight = typeof outputAnchor === "number" ? Math.max(0, outputAnchor) : rate;
      if (weight <= 0) continue;
      const offeredSold = soldByCommodityBySector.get(commodity)?.get(s.sectorId) ?? 1;
      const editorialAvailability =
        commodity === "advertising" && Number.isFinite(s.editorialAdvertisingAvailability)
          ? Math.max(0, Math.min(1, s.editorialAdvertisingAvailability!))
          : 1;
      const productAvailability = Number.isFinite(s.offerAvailabilityByCommodity?.[commodity])
        ? Math.max(0, Math.min(1, s.offerAvailabilityByCommodity?.[commodity] ?? 1))
        : 1;
      const availability = editorialAvailability * productAvailability;
      // Placement shrank the offer; without this leg the sold fraction is a
      // share of that shrunken offer, so output nobody bought was still paid.
      const placementLeg = placementRevenueLeg(
        s.offerPlacementByCommodity?.[commodity],
        args.placementRevenuePhase ?? 0
      );
      const sold = offeredSold * availability * placementLeg;
      // State-scoped legs realize their own state's price. Clearing volume
      // locally while realizing price nationally would leave a seller who
      // relieved a local shortage paid at the glutted national level.
      const stateScope = stateScopeFor(commodity, s.sectorId);
      const stateRatio =
        stateScope != null
          ? args.stateMarkets?.priceRatios.get(stateScope)?.get(commodity)
          : undefined;
      const priceLeg = priceRealizationFactor(
        stateRatio ?? groupRatios?.get(commodity) ?? priceRatioByCommodity.get(commodity)
      );
      const quality = s.productQualityByCommodity?.[commodity] ?? s.outputQuality;
      const offerFactor = offerPriceFactor({
        posture,
        priceLeg,
        qualityPremiumEnabled: args.qualityPremiumEnabled,
        quality,
        inputCostIndex: s.inputCostIndex,
        inputCostShare: s.inputCostShare,
        fixedCostShare: s.fixedCostShare,
      });
      const internalUnits = internalUnitsByCommodity.get(commodity)?.get(s.sectorId) ?? 0;
      const offeredUnits = offeredUnitsByCommodity.get(commodity)?.get(s.sectorId) ?? 0;
      const internalSold =
        offeredUnits > 0 ? Math.min(sold, (internalUnits / offeredUnits) * availability) : 0;
      // Group units realize exactly the benchmark, without posture, quality or cost-plus markup.
      const groupFraction =
        (groupFractionByCommodity.get(commodity)?.get(s.sectorId) ?? 0) * availability;
      const revenueFactor =
        Math.max(0, sold - groupFraction - internalSold) * offerFactor +
        (groupFraction + internalSold) * priceLeg;
      offerFactorByCommodity[commodity] = sold > 0 ? revenueFactor / sold : offerFactor;
      rateSum += weight;
      factorSum += weight * revenueFactor;
      revenueWeightByCommodity[commodity] = weight * revenueFactor;
      quotedPostureSum += weight * (offerFactor / priceLeg - 1);
      soldSum += weight * sold;
      soldByCommodity[commodity] = sold;
      const blocked =
        (regulationBlockedByCommodityBySector.get(commodity)?.get(s.sectorId) ?? 0) * availability;
      if (blocked > 0) {
        regulationBlockedByCommodity[commodity] = blocked;
        blockedSum += weight * blocked;
      }
      marketSupplyShareByCommodity[commodity] =
        supplyShareByCommodity.get(commodity)?.get(s.sectorId) ?? 0;
      if (args.recordDelivery)
        deliveredUnitsByCommodity[commodity] =
          deliveredByCommodityBySector.get(commodity)?.get(s.sectorId) ?? 0;
    }
    if (rateSum <= 0) continue;
    const revenueShareByCommodity: Partial<Record<CommodityType, number>> = {};
    if (factorSum > 0 && Number.isFinite(factorSum)) {
      for (const [commodity, revenueWeight] of Object.entries(revenueWeightByCommodity) as Array<
        [CommodityType, number]
      >) {
        if (Number.isFinite(revenueWeight) && revenueWeight > 0)
          revenueShareByCommodity[commodity] = revenueWeight / factorSum;
      }
    }
    const projectSoldUnitsByCommodity = Object.fromEntries(
      Object.entries(s.projectOutputUnitsByCommodity ?? {}).map(([commodity, units]) => [
        commodity,
        Math.max(0, units ?? 0) * (soldByCommodity[commodity as CommodityType] ?? 0),
      ])
    ) as Partial<Record<CommodityType, number>>;
    results.set(s.sectorId, {
      factor: factorSum / rateSum,
      soldFraction: soldSum / rateSum,
      soldByCommodity,
      marketSupplyShareByCommodity,
      ...(args.recordDelivery ? { deliveredUnitsByCommodity } : {}),
      ...(blockedSum > 0
        ? { regulationBlockedFraction: blockedSum / rateSum, regulationBlockedByCommodity }
        : {}),
      effectivePosture: s.inputCostIndex !== undefined ? quotedPostureSum / rateSum : posture,
      offerFactorByCommodity,
      ...(Object.keys(revenueShareByCommodity).length > 0 ? { revenueShareByCommodity } : {}),
      ...(s.productProjectId
        ? {
            productProjectId: s.productProjectId,
            productOutputTurn: s.productOutputTurn,
            projectOutputUnitsByCommodity: s.projectOutputUnitsByCommodity,
            projectSoldUnitsByCommodity,
            projectQualityByCommodity: s.projectQualityByCommodity,
          }
        : {}),
    });
  }
  return results;
}
