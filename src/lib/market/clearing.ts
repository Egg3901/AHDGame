import type { CommodityType } from "@/lib/constants/commodities";
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

export const PRICING_POSTURE_MIN = -0.2;
export const PRICING_POSTURE_MAX = 0.2;

/** Clamp a raw posture input to a valid value in [−0.2, 0.2]. */
export function clampPricingPosture(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(PRICING_POSTURE_MIN, Math.min(PRICING_POSTURE_MAX, value));
}

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
export const QUALITY_PREMIUM_REF = 50;
/** Slope: how far a full-scale quality swing (0…100) moves the premium multiplier. */
export const QUALITY_PREMIUM_STRENGTH = 0.3;
export const QUALITY_PREMIUM_MULT_MIN = 0.5;
export const QUALITY_PREMIUM_MULT_MAX = 1.5;

/**
 * Multiplier applied to a positive pricing posture given the seller's output
 * quality (0–100). 1.0 at neutral quality; > 1 rewards a premium brand, < 1
 * penalizes a premium on low quality. Clamped to keep the effect bounded.
 * Returns 1 (no effect) for non-finite quality.
 */
export function qualityPremiumMultiplier(quality: number): number {
  if (!Number.isFinite(quality)) return 1;
  const raw =
    1 + (QUALITY_PREMIUM_STRENGTH * (quality - QUALITY_PREMIUM_REF)) / QUALITY_PREMIUM_REF;
  return Math.max(QUALITY_PREMIUM_MULT_MIN, Math.min(QUALITY_PREMIUM_MULT_MAX, raw));
}

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
  /** Units offered this turn. */
  units: number;
  /** Posted price relative to market, −0.2 … 0.2. */
  posture: number;
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
    const p = clampPricingPosture(s.posture);
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
  /** Posted posture (player-set), or null to auto-position (NPP/unowned). */
  posture: number | null;
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
   * carrying the ledger-side legs the caller applies (natcorpScale ×
   * outputMultiplier) so the offer is comparable to `balances`. When
   * supplied AND the caller sets `plantsEnabled`, the offered book is built
   * from these units instead of from the revenue nameplate. Null/absent falls
   * back to the legacy revenue-derived offer.
   */
  producedUnits?: number | null;
}

/**
 * Per-commodity book-sanity diagnostic emitted by computeClearingFactors.
 * The raw book can legitimately exceed lagged supply because legacy nameplate
 * offers omit ledger-side scale and extraction haircuts. Callers should apply
 * mismatch tripwires to normalizedOfferedUnits, not rawOfferedUnits. A large
 * post-normalization excess means exempt measured production and the balance
 * ledger are in different units, so fill rates can still be depressed.
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
}

export interface SectorClearingResult {
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
  /** Posture actually used (player's, or the auto value). */
  effectivePosture: number;
}

/**
 * Run the clearing pass across every selling sector for every commodity.
 * Pure: consumes lagged balances/prices, returns per-sector factors.
 */
export function computeClearingFactors(args: {
  sectors: readonly SectorClearingInput[];
  /** Lagged per-commodity aggregate balances (prior turn). */
  balances: ReadonlyMap<CommodityType, { supply: number; demand: number }>;
  /** Lagged price-over-base ratios (prior turn). */
  priceRatioByCommodity: ReadonlyMap<CommodityType, number>;
  basePrices: Record<CommodityType, number>;
  /** Optional book-sanity hook — called once per cleared commodity. */
  onBookDiagnostic?: (d: ClearingBookDiagnostic) => void;
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

  // Loyal-slice lookup (seller id === sectorId), built only when the slice is on.
  const loyaltyBySectorId = args.loyaltySliceEnabled
    ? new Map<string, number>(sectors.map((s) => [s.sectorId, Math.max(0, s.brandLoyalty ?? 0)]))
    : undefined;

  // 1) Resolve each sector's effective posture + offered units per commodity.
  const sellersByCommodity = new Map<CommodityType, ClearingSeller[]>();
  const postureBySector = new Map<string, number>();
  for (const s of sectors) {
    for (const commodity of Object.keys(s.supplyRates) as CommodityType[]) {
      const rate = s.supplyRates[commodity] ?? 0;
      if (rate <= 0) continue;
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
        args.plantsEnabled && typeof s.producedUnits === "number" && s.producedUnits >= 0
          ? s.producedUnits * mixWeight(s.supplyRates, basePrices, commodity)
          : null;
      const units = plantsUnits ?? (base > 0 ? (s.revenue * rate) / base : 0);
      if (units <= 0) continue;
      sellersByCommodity.set(commodity, [
        ...(sellersByCommodity.get(commodity) ?? []),
        { id: s.sectorId, units, posture, realUnits: plantsUnits != null },
      ]);
    }
  }

  // 2) Clear each commodity market against LAGGED demand. Sellers outside this
  //    pass (unowned pools, imports) are represented by the gap between the
  //    lagged aggregate supply and the units offered here: demand available to
  //    these sellers is scaled by their share of total supply so the pass
  //    doesn't hand corporate sectors the whole market.
  const soldByCommodityBySector = new Map<CommodityType, Map<string, number>>();
  for (const [commodity, sellers] of sellersByCommodity) {
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
    for (const [g, groupSellers] of partitioned) {
      const bal = balanceForBook(g, commodity);
      const laggedSupply = bal?.supply ?? 0;
      const offeredUnits = groupSellers.reduce((sum, s) => sum + s.units, 0);
      const totalSupply = Math.max(laggedSupply, offeredUnits);
      const share = totalSupply > 0 ? offeredUnits / totalSupply : 1;
      const demandForPass = (bal?.demand ?? 0) * share;

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

      const groupSold = clearCommodityMarket(
        demandForPass,
        groupSellers,
        loyaltyBySectorId,
        contractedUnitsById
      );
      for (const [id, f] of groupSold) sold.set(id, f);
    }
    soldByCommodityBySector.set(commodity, sold);

    // Production sink: each corp's offered units for this commodity, recorded
    // BEFORE any fill outcome. Under plants these are real produced units.
    if (args.producedUnitsOut && args.sectorCorpId) {
      for (const s of sellers) {
        const corpId = args.sectorCorpId.get(s.id);
        if (!corpId || !(s.units > 0)) continue;
        const byCommodity = args.producedUnitsOut.get(corpId) ?? new Map<CommodityType, number>();
        byCommodity.set(commodity, (byCommodity.get(commodity) ?? 0) + s.units);
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
  const results = new Map<string, SectorClearingResult>();
  for (const s of sectors) {
    let rateSum = 0;
    let factorSum = 0;
    let soldSum = 0;
    const posture = postureBySector.get(s.sectorId) ?? 0;
    // Quality → premium: only a positive (premium) posture is quality-scaled,
    // and only when the caller opted in with a finite quality. The base price
    // and any undercut are untouched, so quality can lift or shave the premium
    // but never let a seller charge below market.
    const premiumMult =
      args.qualityPremiumEnabled && posture > 0 && s.outputQuality != null
        ? qualityPremiumMultiplier(s.outputQuality)
        : 1;
    const effectivePremium = posture > 0 ? posture * premiumMult : posture;
    const soldByCommodity: Partial<Record<CommodityType, number>> = {};
    const sectorGroup = args.groupBySector?.get(s.sectorId);
    const groupRatios = sectorGroup != null ? args.priceRatioByGroup?.get(sectorGroup) : undefined;
    for (const commodity of Object.keys(s.supplyRates) as CommodityType[]) {
      const rate = s.supplyRates[commodity] ?? 0;
      if (rate <= 0) continue;
      const sold = soldByCommodityBySector.get(commodity)?.get(s.sectorId) ?? 1;
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
      rateSum += rate;
      factorSum += rate * sold * (1 + effectivePremium) * priceLeg;
      soldSum += rate * sold;
      soldByCommodity[commodity] = sold;
    }
    if (rateSum <= 0) continue;
    results.set(s.sectorId, {
      factor: factorSum / rateSum,
      soldFraction: soldSum / rateSum,
      soldByCommodity,
      effectivePosture: posture,
    });
  }
  return results;
}
