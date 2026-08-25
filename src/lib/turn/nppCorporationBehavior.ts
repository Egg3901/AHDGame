// src/lib/turn/nppCorporationBehavior.ts
/**
 * NPP Corporation AI Behavior
 *
 * Each turn, NPP-run corporations make autonomous decisions:
 * - Analyze sector profitability to guide all decisions
 * - Adjust growth rates aggressively based on margin bands
 * - Scale budgets as % of REVENUE (not cash) — spend only what you earn
 * - Kill losing sectors (divest) that drag overall profitability
 * - Expand only when profitable with strong margins and cash buffer
 * - Set dividend rate based on profit margin, not just existence of profit
 * - Maintain a cash floor to avoid insolvency
 */

import type { Db, ObjectId } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  SectorBuildOrder,
  StateMetrics,
  GameConfig,
  GameState,
  ExchangeRate,
  Bond,
} from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isCorporateIssuerBond } from "@/lib/bonds/corporateCredit";
import { netPerTurnDebtServiceAnchor } from "@/lib/bonds/corpBondCashflows";
import {
  findBestUnownedSector,
  hasEnterableHeadroom,
  sectorShortageScore,
  computeMacroProductionPolicy,
  type CommodityPriceRatioFn,
  type PlacementSignals,
} from "@/lib/turn/npp/marketSignals";

// Re-exported so existing importers (and their tests) keep one entry point.
export {
  sectorShortageScore,
  computeMacroProductionPolicy,
  type CommodityPriceRatioFn,
} from "@/lib/turn/npp/marketSignals";
import {
  advanceStrategy,
  strategyLevers,
  type NppStrategyState,
  type StrategySituation,
} from "@/lib/turn/npp/corpStrategy";
import type { NPP } from "@/lib/db/types/npp";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import {
  deriveCeoArchetype,
  ceoArchetypeModifiers,
  type CeoArchetype,
  type CeoArchetypeModifiers,
} from "@/lib/turn/ceoArchetype";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { CommodityType } from "@/lib/constants/commodities";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import {
  STRANDED_DIVEST_TURNS,
  STRANDED_DIVEST_MAX_PER_TURN,
} from "@/lib/corporations/strandedPlant";
import { clampWageLevel } from "@/lib/labour/laborCost";
import { labourAtLeast, isLabourSystemMode } from "@/lib/labour/modes";
import { CHRONIC_LOW_FILL_THRESHOLD } from "@/lib/turn/npp/strategyExpectedRevenue";
import {
  bucketKey,
  computeStateControlledBuckets,
  loadNationalCorpIds,
} from "@/lib/nationalization/stateControlledBuckets";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { emitBuildCapexTxBulk } from "@/lib/corporations/capexTxLog";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { sumStrengthGrants } from "@/lib/constants/techTree";
import { CAPACITY_BUILD_TURNS, computeBuildCost } from "@/lib/constants/capacityEconomy";
import { SECTOR_STRATEGIES, STRATEGY_COOLDOWN_TURNS } from "@/lib/constants/sectorStrategies";
import { getStrategyAvailability } from "@/lib/constants/techTree/strategyAvailability";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { retoolRescaleFields } from "@/lib/corporations/retoolRescale";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import {
  unownedHeadroomBaseExpr,
  unownedHeadroomUnitsPerAnchor,
  unownedPoolTrailingSet,
} from "@/lib/market/unownedHeadroom";
import {
  getExtractionOutputScaleEnabled,
  getMarketSystemModeForDb,
  marketAtLeast,
} from "@/lib/market/featureFlag";
import { resolveCountryPrimeRate } from "@/lib/corporations/sectorGrowthCost";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import {
  anchorToCorpCapital,
  resolveSectorHostCurrencyCode,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { pickBestNppTechNode } from "@/lib/turn/npp/corpBehaviorConfig";
import { computeExtractionHeadroomByState } from "@/lib/turn/nppExtractionOpportunity";

export { computeExtractionHeadroomByState } from "@/lib/turn/nppExtractionOpportunity";

/**
 * Largest share of a sector's gross margin that may be spent on growth before an
 * NPP stops expanding it. Half leaves the other half to cover corporate
 * overhead and still return a profit.
 */
const GROWTH_COST_MARGIN_SHARE = 0.5;

// Plants reinvestment converts the existing growth judgement into purchased
// replacement and growth capacity, bounded by fill, headroom, cash, and queue
// rails. Aggression is the calibration knob; the other values are safety caps.
const NPP_REINVEST_AGGRESSION = 1.0;
/** Minimum evidence of demand before buying more capacity. */
const NPP_REINVEST_MIN_FILL = 0.85;
/** Queue depth is a storage bound; replacement size carries the cadence. */
const NPP_REINVEST_MAX_QUEUE_DEPTH = 20;
/** Stop discretionary growth sooner than necessary replacement. */
const NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH = 2;
/** One growth order may claim at most a quarter of open headroom. */
const NPP_REINVEST_HEADROOM_SHARE = 0.25;
/** Prevent a cash-rich conglomerate from buying every market at once. */
const NPP_REINVEST_MAX_SECTORS_PER_TURN = 1;
/** Maintenance may use a cash share even below the discretionary entry floor. */
const NPP_REINVEST_MAINTENANCE_CASH_SHARE = 0.25;

// Anchor-denominated rails gate expansion, dividends, and growth capex. Their
// ratios preserve a cash buffer while fitting the 1953 economy scale.
const CASH_FLOOR = 250_000; // Never spend below this
const EXPANSION_COST = 500_000;
const EXPANSION_MIN_CASH = 625_000; // Need this much above floor to expand
const EXPANSION_MIN_MARGIN = 15; // Corp-level avg margin must be healthy
const MAX_SECTORS = 5;

// Archetypes may scale the rails but never remove the minimum buffer.
const SAFE_CASH_FLOOR_MIN = 125_000; // an aggressive floor still leaves a buffer
const MAX_DIVIDEND_RATE = 12; // cap any archetype-boosted payout

/** Default archetype for corps whose CEO NPP can't be resolved (legacy / mid-migration). */
const DEFAULT_ARCHETYPE: CeoArchetype = "cautious";

// Glut response uses fill as the linear signal and a wide restart band.
const GLUT_MOTHBALL_FILL_THRESHOLD = 0.25;
const GLUT_MOTHBALL_PRICE_RATIO = 0.65;
const GLUT_RESTART_PRICE_RATIO = 0.9;

/** Per-turn wage step toward the target. 0.02 × ~4 turns reaches the shortage premium. */
const NPP_WAGE_STEP = 0.02;
const NPP_WAGE_BASELINE = 1;
const NPP_WAGE_SHORTAGE_TARGET = 1.08;
const NPP_WAGE_GLUT_TARGET = 0.95;

/** Spread cohort state changes across turns to avoid supply cliffs. */
export const GLUT_STATE_CHANGE_STAGGER = 8;

/** Deterministic per-corp turn slot for glut state changes (exported for tests). */
export function glutStaggerEligible(corpId: string, turn: number): boolean {
  const tail = parseInt(corpId.slice(-6), 16);
  const hash = Number.isFinite(tail) ? tail : 0;
  return (hash + turn) % GLUT_STATE_CHANGE_STAGGER === 0;
}

// Re-score NPP recipes against reachable prices so an input squeeze can trigger
// a strategy shift instead of destroying otherwise useful capacity.

/** effectiveProfitMargin at/below which a sector is a shift candidate (pp). */
export const STRATEGY_SHIFT_MARGIN_TRIGGER = -3;
/** Required price-score advantage over the current strategy (revenue share). */
export const STRATEGY_SHIFT_MIN_ADVANTAGE = 0.08;
/** High bar for a profitable sector to retool toward a shortage. */
export const STRATEGY_SHIFT_PROFIT_SEEK_ADVANTAGE = 0.25;

/**
 * Price advantage of a strategy per ₳ of revenue: Σ supplyRate × (ratio − 1)
 * − Σ demandRate × (ratio − 1). Positive means the recipe sells into
 * expensive markets and buys from cheap ones. Null when no priced commodity
 * on either side has a ratio (a market that has never priced).
 */
export function strategyPriceScore(
  strategy: {
    supply: Partial<Record<CommodityType, number>>;
    demand: Partial<Record<CommodityType, number>>;
  },
  countryId: string,
  priceRatioOf: CommodityPriceRatioFn
): number | null {
  let score = 0;
  let priced = false;
  for (const [commodity, rate] of Object.entries(strategy.supply)) {
    if (!(typeof rate === "number" && rate > 0)) continue;
    const ratio = priceRatioOf(commodity as CommodityType, countryId);
    if (ratio == null) continue;
    score += rate * (ratio - 1);
    priced = true;
  }
  for (const [commodity, rate] of Object.entries(strategy.demand)) {
    if (!(typeof rate === "number" && rate > 0)) continue;
    const ratio = priceRatioOf(commodity as CommodityType, countryId);
    if (ratio == null) continue;
    score -= rate * (ratio - 1);
    priced = true;
  }
  return priced ? score : null;
}

interface NppCorpDecisionContext {
  corp: Corporation;
  sectors: CorporateSector[];
  turn: number;
  now: Date;
  /** Behavior modifiers derived from the CEO NPP's personality. */
  modifiers: CeoArchetypeModifiers;
  /** Local units per anchor unit for the corporation's liquid currency. */
  fxRate?: number;
  /**
   * Live local-per-₳ rates used to restate each sector's host-currency
   * revenue into the corporation's home currency before combining sectors.
   */
  fxByCurrency?: ReadonlyMap<string, number>;
  /**
   * When true (labourSystemMode at least wages), section 2d writes wageLevel.
   * Absent/false leaves wages untouched so pre-labour worlds stay byte-identical.
   */
  labourWagesEnabled?: boolean;
  /**
   * World year + tech-tree flag for section 2e's strategy availability gating
   * (mirrors the player setSectorStrategy path). Absent → gating treats the
   * world as tech-disabled, exactly like getStrategyAvailability does.
   */
  currentYear?: number;
  techTreesEnabled?: boolean;
  /** Net per-turn debt service in anchor currency; positive is a drag. */
  debtServiceAnchor?: number;
  /** Persisted strategy memory; absent adopts the legacy expand behavior. */
  strategy?: NppStrategyState;
  /** True on this corporation's cohort-stagger slot. */
  strategyEligible?: boolean;
  /** Explicit false disables strategy memory and pins legacy expand levers. */
  strategyLoopEnabled?: boolean;
}

/**
 * A sector write this module emits. `$set` is the common case (growth target,
 * production policy); capacity reinvestment additionally uses `$push`/`$inc`
 * so its build order composes with `sectorTurn`'s `$pull` of landed orders
 * instead of clobbering it — see the C4 note there and at the push site below.
 */
type NppSectorUpdateDoc = {
  $set: Record<string, unknown>;
  $push?: Record<string, unknown>;
  $inc?: Record<string, number>;
};

interface NppCorpDecision {
  corpId: ObjectId;
  updates: Record<string, unknown>;
  sectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }>;
  newSectors?: Array<{
    stateId: string;
    countryId: string;
    sectorType: CorporationType;
    revenue: number;
    profitMargin: number;
    /**
     * Plants only. The founding build the corp just paid for: the sector is
     * created with `capitalStock` 0 and this order queued, exactly as
     * `expandSector` founds a player sector.
     */
    starterOrder?: SectorBuildOrder;
  }>;
  divestedSectorIds?: ObjectId[];
  /**
   * Plants only. Headroom (in capacity units) this decision consumed from the
   * unowned pool it expanded into, for the caller to draw down. Founding a
   * sector CONSUMES market headroom; before this, NPP expansion minted capacity
   * while leaving the pool untouched, double-counting the same demand.
   */
  unownedDraws?: Array<{
    stateId: string;
    sectorType: CorporationType;
    units: number;
    /** Needed by the drawdown's upsert scaffolding when the pool row is absent. */
    countryId: string;
  }>;
  /**
   * Plants only. Capacity builds this corp placed into EXISTING sectors this
   * turn. The queue/CIP writes ride the normal `sectorUpdates` channel; this
   * list exists so the caller can emit the matching capex ledger legs (the cash
   * → CIP reclass), which need DB access.
   */
  /** v5 strategy memory to persist for this corp. */
  strategy?: NppStrategyState;
  reinvestments?: Array<{
    sectorId: ObjectId;
    sectorType: CorporationType;
    units: number;
    costAnchor: number;
    costLocal: number;
    onlineTurn: number;
  }>;
}

/**
 * World facts an NPP needs to price a founding build the same way a player's
 * `expandSector` does. Absent (or `enabled: false`) ⇒ the legacy flat-cost path,
 * byte-identical to pre-plants behaviour.
 */
export interface NppPlantsContext {
  enabled: boolean;
  /** World year — drives the capacity era price column. */
  year: number;
  /** The world's era unit-basis scale (`getEraUnitScale(preset)`). */
  eraUnitScale: number;
  /** Seed preset id — entry fee is era-scaled through the same helper players use. */
  preset: string | undefined;
  /** Host country's prime rate (%), for the build's financing multiplier. */
  primeRateOf: (countryId: string) => number;
  /** Host state's 100-centered costOfLiving, or null when unmetered. */
  costOfLivingOf: (stateId: string) => number | null;
}

interface SectorProfitInfo {
  sector: CorporateSector;
  income: number; // revenue × (profitMargin / 100)
  margin: number;
  isProfitable: boolean;
  marginCategory: "loss" | "thin" | "healthy" | "strong";
}

/**
 * Process all NPP-run corporations each turn.
 * Returns decisions that the caller applies via bulkWrite.
 */
export async function processNppCorporationDecisions(
  db: Db,
  turn: number,
  now: Date,
  techTreesEnabled: boolean = false
): Promise<{
  corpUpdates: Array<{
    filter: { _id: ObjectId; unlockedTechNodeIds?: { $ne: string } };
    update: {
      $set: Record<string, unknown>;
      $inc?: Record<string, number>;
      $addToSet?: { unlockedTechNodeIds: string };
    };
  }>;
  sectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }>;
  newSectors: Array<Omit<CorporateSector, "_id"> & { _id: ObjectId }>;
  divestedSectorIds: ObjectId[];
}> {
  const nppCorps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", suspended: { $ne: true } })
    .toArray();

  const corpUpdates: Array<{
    filter: { _id: ObjectId; unlockedTechNodeIds?: { $ne: string } };
    update: {
      $set: Record<string, unknown>;
      $inc?: Record<string, number>;
      $addToSet?: { unlockedTechNodeIds: string };
    };
  }> = [];
  const allSectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }> = [];
  const newSectors: Array<Omit<CorporateSector, "_id"> & { _id: ObjectId }> = [];
  const allDivestedSectorIds: ObjectId[] = [];

  if (nppCorps.length === 0)
    return {
      corpUpdates,
      sectorUpdates: allSectorUpdates,
      newSectors,
      divestedSectorIds: allDivestedSectorIds,
    };

  // Fetch all sectors for these corps in one query
  const corpIds = nppCorps.map((c) => c._id);
  const allSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: { $in: corpIds } })
    .toArray();

  // Resolve each corp's CEO NPP so its personality can shape the corp's behavior.
  // ceoId holds the NPP _id when ceoType === "npp".
  const ceoNppIds = nppCorps.filter((c) => c.ceoType === "npp" && c.ceoId).map((c) => c.ceoId);
  const ceoNpps =
    ceoNppIds.length > 0
      ? await db
          .collection<NPP>("npps")
          .find({ _id: { $in: ceoNppIds } }, { projection: { personality: 1 } })
          .toArray()
      : [];
  const archetypeByNppId = new Map<string, CeoArchetype>();
  for (const npp of ceoNpps) {
    if (npp.personality) {
      archetypeByNppId.set(npp._id.toString(), deriveCeoArchetype(npp.personality));
    }
  }

  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const sector of allSectors) {
    const cid = sector.corporationId.toString();
    if (!sectorsByCorp.has(cid)) sectorsByCorp.set(cid, []);
    sectorsByCorp.get(cid)!.push(sector);
  }

  // Commodity price snapshot for macro-aware production policy (SP5). One doc
  // per commodity; keep the latest turn if duplicates exist.
  const commodityPriceDocs = await db
    .collection<CommodityPrice>("commodityPrices")
    .find({})
    .toArray();
  const priceByCommodity = new Map<string, CommodityPrice>();
  for (const doc of commodityPriceDocs) {
    const existing = priceByCommodity.get(doc.commodity);
    if (!existing || (doc.turn ?? 0) >= (existing.turn ?? 0)) {
      priceByCommodity.set(doc.commodity, doc);
    }
  }
  const priceRatioOf: CommodityPriceRatioFn = (commodity, countryId) => {
    const doc = priceByCommodity.get(commodity);
    if (!doc || !doc.basePrice) return null;
    // Reachable-market price first (partition worlds): the NPP brain should
    // chase the market its sectors actually clear in, not the planet-wide
    // aggregate — same rationale as the reachable price/margin legs.
    const price =
      doc.reachablePrices?.[countryId] ?? doc.nationalPrices?.[countryId] ?? doc.globalPrice;
    if (!price || !Number.isFinite(price)) return null;
    return price / doc.basePrice;
  };

  // ── Placement signals (supply-dislocation remediation, t202) ──────────────
  // State-resolution price ratios plus deposit headroom, so foundings route to
  // the state that is actually starved / has room, not just the corp's HQ.
  const statePriceRatioOf = (commodity: CommodityType, stateId: string): number | null => {
    const doc = priceByCommodity.get(commodity);
    if (!doc || !doc.basePrice) return null;
    const price = doc.statePrices?.[stateId];
    if (price == null || !Number.isFinite(price)) return null;
    return price / doc.basePrice;
  };

  // Value-weighted unclaimed deposit headroom per state, in [0, 1]. Desired
  // output uses the supply ledger's era and output-scale unit basis, matching
  // computeResourceOpportunities and the capacity clamp.
  const [capDocs, extractionEraUnitScale, extractionConfig] = await Promise.all([
    db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .find({}, { projection: { stateId: 1, resources: 1 } })
      .toArray(),
    loadWorldEraUnitScale(db),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { extractionOutputScaleEnabled: 1 } }),
  ]);
  const extractionOutputScaleEnabled = await getExtractionOutputScaleEnabled(extractionConfig);
  const extractionHeadroomByState = computeExtractionHeadroomByState(
    capDocs,
    allSectors,
    extractionEraUnitScale,
    extractionOutputScaleEnabled
  );
  const placementSignals: PlacementSignals = {
    statePriceRatioOf,
    // A state with no capacity doc has no deposits — headroom 0, never found there.
    extractionHeadroomOf: (stateId) => extractionHeadroomByState.get(stateId) ?? 0,
  };

  // Fetch unowned sectors in bulk for expansion decisions
  const unownedSectors = await db.collection<UnownedSector>("unownedSectors").find({}).toArray();

  // Index unowned sectors by countryId for fast lookup
  const unownedByCountry = new Map<string, UnownedSector[]>();
  for (const us of unownedSectors) {
    if (!unownedByCountry.has(us.countryId)) unownedByCountry.set(us.countryId, []);
    unownedByCountry.get(us.countryId)!.push(us);
  }
  // Same docs, keyed by the (state, type) bucket, so the per-corp loop can
  // deplete the pool a founding just drew from. The values are the SAME object
  // references the country index holds, so mutating through here is visible to
  // every later `findBestUnownedSector` call in the pass.
  const unownedIndex = new Map<string, UnownedSector>();
  for (const us of unownedSectors) {
    unownedIndex.set(bucketKey(us.stateId, us.sectorType), us);
  }

  // Buckets a National Corporation controls — NPP corps must not auto-expand into
  // a sector the state has nationalized (it would slowly re-fragment a state
  // monopoly). Players may still deliberately enter; this only gates the AI.
  const [nationalCorpIds, globalSectors] = await Promise.all([
    loadNationalCorpIds(db),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        {},
        {
          projection: {
            stateId: 1,
            sectorType: 1,
            revenue: 1,
            corporationId: 1,
            nationalizedAtTurn: 1,
          },
        }
      )
      .toArray(),
  ]);
  const stateControlled = computeStateControlledBuckets(globalSectors, nationalCorpIds);

  // ─── Plants context, resolved ONCE for the whole cohort ───────────────────
  // Prime rate is per country and costOfLiving per state; both are small,
  // bounded reads that would otherwise be repeated per corp per turn.
  // PLANTS-GATED: the NPP founding insert below writes `revenue` only as the
  // legacy nameplate for non-plants readers. Under plants the new sector is born
  // with `capitalStock` 0, the founding build order queued, CIP set and
  // `plantsStartTurn` stamped, and the turn processor restates revenue from that
  // capacity on the next tick. The unowned pool is drawn down to match.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  let plants: NppPlantsContext | undefined;
  if (plantsEnabled) {
    const gsPlants = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, startingYear: 1, currentTurn: 1, preset: 1 } }
      );
    const plantsYear =
      gsPlants?.currentYear ??
      (gsPlants?.startingYear ?? STARTING_YEAR) +
        Math.floor(((gsPlants?.currentTurn ?? turn) - 1) / TURNS_PER_YEAR);

    const countryIds = [...new Set(nppCorps.map((c) => c.countryId))];
    const primeByCountry = new Map<string, number>(
      await Promise.all(
        countryIds.map(
          async (cid) => [cid, await resolveCountryPrimeRate(db, cid)] as [string, number]
        )
      )
    );
    const colDocs = await db
      .collection<StateMetrics>("macroMetrics")
      .find({}, { projection: { "economic.costOfLiving": 1 } })
      .toArray();
    const colByState = new Map<string, number>();
    for (const doc of colDocs) {
      const value = doc.economic?.costOfLiving?.value;
      if (typeof value === "number" && Number.isFinite(value)) {
        colByState.set(String(doc._id), value);
      }
    }
    plants = {
      enabled: true,
      year: plantsYear,
      eraUnitScale: await loadWorldEraUnitScale(db),
      preset: resolvePresetIdFromGameState(gsPlants),
      primeRateOf: (cid) => primeByCountry.get(cid) ?? 0,
      costOfLivingOf: (sid) => colByState.get(sid) ?? null,
    };
  }
  const unownedDraws: NonNullable<NppCorpDecision["unownedDraws"]> = [];
  // Capex ledger legs for NPP capacity reinvestment, flushed in one insert
  // below. A build is a cash → CIP RECLASS, and the shadow ledger drops rows
  // with no anchor value, so every row carries both the local and ₳ magnitude.
  const capexRows: Parameters<typeof emitBuildCapexTxBulk>[1] = [];

  // Resolve the world's current decade once for NPP tech-tree auto-picks.
  let techCurrentYear = 0;
  if (techTreesEnabled) {
    const gs = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, startingYear: 1, currentTurn: 1 } }
      );
    const startingYear = gs?.startingYear ?? STARTING_YEAR;
    techCurrentYear =
      gs?.currentYear ??
      startingYear + Math.floor(((gs?.currentTurn ?? turn) - 1) / TURNS_PER_YEAR);
  }

  // Local-per-₳ rates for every live currency, loaded once. NPP money constants
  // are all ₳; `liquidCapital` is not. See `NppCorpDecisionContext.fxRate`.
  const fxByCurrency = new Map<string, number>();
  for (const rate of await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()) {
    if (rate.currencyCode && typeof rate.rate === "number" && rate.rate > 0) {
      fxByCurrency.set(rate.currencyCode, rate.rate);
    }
  }

  // ─── Debt service, loaded once for the cohort ─────────────────────────────
  // Same two maps `buildCorporationLookups` builds for the turn engine, and the
  // same helpers it charges with, so the brain reads the number the engine
  // actually bills rather than an approximation of it. Issuer side is corporate
  // bonds only; holder side keeps sovereigns, because a corp parking cash in
  // treasuries genuinely collects that coupon.
  const activeBonds = await db.collection<Bond>("bonds").find({ matured: false }).toArray();
  const issuerBondsByCorpId = new Map<string, Bond[]>();
  const heldBondsByCorpId = new Map<string, { bond: Bond; units: number }[]>();
  for (const b of activeBonds) {
    if (isCorporateIssuerBond(b)) {
      const cid = b.corporationId.toString();
      const list = issuerBondsByCorpId.get(cid) ?? [];
      list.push(b);
      issuerBondsByCorpId.set(cid, list);
    }
    for (const h of b.holders ?? []) {
      const holderCorpId = h.corporationId?.toString();
      if (!holderCorpId) continue;
      const held = heldBondsByCorpId.get(holderCorpId) ?? [];
      held.push({ bond: b, units: h.units });
      heldBondsByCorpId.set(holderCorpId, held);
    }
  }

  // Cohort-wide kill switch, read once. Absent means ON.
  const strategyGate = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { nppCorpStrategyEnabled: 1 } });
  const strategyLoopEnabled = strategyGate?.nppCorpStrategyEnabled !== false;

  const labourCfg = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { labourSystemMode: 1 } });
  const labourMode = labourCfg?.labourSystemMode;
  const labourWagesEnabled = isLabourSystemMode(labourMode) && labourAtLeast(labourMode, "wages");

  for (const corp of nppCorps) {
    const sectors = sectorsByCorp.get(corp._id.toString()) ?? [];
    const archetype =
      (corp.ceoId && archetypeByNppId.get(corp.ceoId.toString())) || DEFAULT_ARCHETYPE;
    const corpCurrency = resolveCorpLiquidCurrencyCode(corp);
    const decision = makeNppCorpDecision(
      {
        corp,
        sectors,
        turn,
        now,
        fxRate: (corpCurrency && fxByCurrency.get(corpCurrency)) || 1,
        fxByCurrency,
        strategy: corp.nppStrategy,
        // Same 1-in-8 cohort slot the glut mothball pass uses.
        strategyEligible: glutStaggerEligible(corp._id.toString(), turn),
        strategyLoopEnabled,
        debtServiceAnchor: netPerTurnDebtServiceAnchor({
          issuerBonds: issuerBondsByCorpId.get(corp._id.toString()),
          heldPositions: heldBondsByCorpId.get(corp._id.toString()),
          fxByCurrency: fxByCurrency as ReadonlyMap<CurrencyCode, number>,
          // The government bond subsidy waives issuer interest for national
          // enterprises, exactly as `perTurnBondDragOnNetIncome` does.
          isNationalEnterprise: !!corp.countryOwnerId,
        }),
        modifiers: ceoArchetypeModifiers(archetype),
        labourWagesEnabled,
        currentYear: techCurrentYear > 0 ? techCurrentYear : undefined,
        techTreesEnabled,
      },
      unownedByCountry,
      stateControlled,
      priceRatioOf,
      plants,
      placementSignals
    );

    if (decision.reinvestments && corpCurrency) {
      for (const r of decision.reinvestments) {
        capexRows.push({
          corporationId: corp._id,
          corporationName: corp.name ?? "NPP corporation",
          corporationSequentialId: corp.sequentialId,
          direction: "build",
          amountLocal: Math.abs(r.costLocal),
          currencyCode: corpCurrency,
          anchorAmount: Math.abs(r.costAnchor),
          turn,
          createdAt: now,
          sectorId: r.sectorId,
          sectorType: r.sectorType,
          units: r.units,
          meta: { source: "npp_reinvestment", onlineTurn: r.onlineTurn },
        });
      }
    }

    if (decision.unownedDraws) {
      unownedDraws.push(...decision.unownedDraws);
      // ─── Deplete the in-memory pool BEFORE the next corp decides ───────────
      //
      // `unownedByCountry` is loaded once, above, and `makeNppCorpDecision` is
      // pure: it sizes an entry at `headroomUnits × 0.25` off whatever snapshot
      // it is handed. Without this mutation every NPP that picks the same
      // (stateId, sectorType) bucket in one pass sizes off the SAME pre-draw
      // pool, all of them are granted that capacity, and the bulk drawdown
      // below clamps at 0 — so N entrants into one bucket mint N × 0.25 × pool
      // units while at most `pool` is consumed. That is the very capacity mint
      // the drawdown exists to close, reintroduced one loop iteration up.
      //
      // Depleting the snapshot in lockstep (units lead, `revenue` derived from
      // the same quantity) makes each later corp in the pass see the pool the
      // earlier ones actually left behind.
      for (const draw of decision.unownedDraws) {
        const pool = unownedIndex.get(bucketKey(draw.stateId, draw.sectorType));
        if (!pool) continue;
        const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(
          draw.sectorType,
          plants?.eraUnitScale ?? 1
        );
        const remaining = Math.max(
          0,
          unownedHeadroomUnitsOf(
            draw.sectorType,
            pool.headroomUnits,
            pool.revenue,
            plants?.eraUnitScale ?? 1
          ) - draw.units
        );
        pool.headroomUnits = remaining;
        pool.revenue = unitsPerAnchor > 0 ? Math.round(remaining / unitsPerAnchor) : pool.revenue;
      }
    }

    if (Object.keys(decision.updates).length > 0) {
      corpUpdates.push({
        filter: { _id: decision.corpId },
        update: { $set: decision.updates },
      });
    }

    // Sector tech tree: auto-unlock one node per turn when affordable. Separate
    // op from the budget decision above (same _id) — bulkWrite applies both.
    if (techTreesEnabled) {
      const dailyGrossRevenue =
        sectors.reduce((sum, s) => sum + (s.revenue ?? 0), 0) * TURNS_PER_DAY;
      const pick = pickBestNppTechNode(corp, techCurrentYear, dailyGrossRevenue);
      if (pick) {
        const { node: techNode, cashCost } = pick;
        const grants = sumStrengthGrants(techNode.effects);
        const techInc: Record<string, number> = {
          rdScore: -techNode.cost,
          liquidCapital: -cashCost,
        };
        if (grants.marketingStrength > 0) techInc.marketingStrength = grants.marketingStrength;
        if (grants.logisticsStrength > 0) techInc.logisticsStrength = grants.logisticsStrength;
        const committing = !(corp.techDecadeLane ?? {})[techNode.decadeId];
        const techSet: Record<string, unknown> = { updatedAt: now };
        if (committing) {
          techSet[`techDecadeLane.${techNode.decadeId}`] = techNode.lane;
          techSet[`techDecadeChosenTurn.${techNode.decadeId}`] = turn;
        }
        corpUpdates.push({
          // $addToSet + not-already-owned filter mirror the player unlock's
          // atomic guard: a concurrent write can no longer resurrect a stale
          // unlockedTechNodeIds array or double-add the node.
          filter: { _id: corp._id, unlockedTechNodeIds: { $ne: techNode.id } },
          update: {
            $set: techSet,
            $inc: techInc,
            $addToSet: { unlockedTechNodeIds: techNode.id },
          },
        });
      }
    }

    if (decision.strategy) {
      corpUpdates.push({
        filter: { _id: corp._id },
        update: { $set: { nppStrategy: decision.strategy, updatedAt: now } },
      });
    }

    allSectorUpdates.push(...decision.sectorUpdates);

    if (decision.newSectors) {
      for (const ns of decision.newSectors) {
        newSectors.push({
          _id: new (await import("mongodb")).ObjectId(),
          corporationId: corp._id,
          countryId: ns.countryId as CountryId,
          stateId: ns.stateId,
          sectorType: ns.sectorType,
          targetGrowthRate: 2,
          currentGrowthRate: 0,
          currentGrowthCost: 0,
          revenue: ns.revenue,
          profitMargin: ns.profitMargin,
          workers: 100,
          createdAt: now,
          updatedAt: now,
          // Plants: born with nothing built and the founding order queued, the
          // same shape `expandSector` gives a player's new sector. Stamping
          // `plantsStartTurn` keeps `sectorTurn` from mistaking a zero-capacity
          // newborn for a legacy sector awaiting the flip migration.
          ...(ns.starterOrder
            ? {
                capitalStock: 0,
                buildQueue: [ns.starterOrder],
                constructionInProgressAnchor: Math.round(ns.starterOrder.costPaidAnchor),
                plantsStartTurn: turn,
              }
            : {}),
        });
      }
    }

    if (decision.divestedSectorIds) {
      allDivestedSectorIds.push(...decision.divestedSectorIds);
    }
  }

  // ─── Draw founded capacity out of the unowned pools (plants) ──────────────
  //
  // Written here rather than returned to the turn orchestrator because this is
  // the same conservation fix `expandSector` applies inline: an NPP founding a
  // sector consumes market headroom, and leaving the pool intact counted the
  // same demand twice (owned capacity AND unowned headroom), inflating world
  // capacity every time the AI expanded. Pipeline update so `headroomUnits` and
  // the legacy `revenue` view move in lockstep; both clamp at 0.
  if (unownedDraws.length > 0) {
    await db.collection<UnownedSector>("unownedSectors").bulkWrite(
      unownedDraws.map(({ stateId, sectorType, units, countryId }) => {
        return {
          updateOne: {
            filter: { stateId, sectorType },
            update: [
              {
                $set: {
                  // UPSERT SCAFFOLDING — the twin of `expandSector`'s founding
                  // drawdown, which this used to omit. A (state, type) bucket
                  // with no pool doc is a legitimate state (the auto-seeder
                  // creates them lazily), and without the upsert this bulk op
                  // matched NOTHING: the draw was silently discarded and the NPP
                  // took its starter capacity for free — the exact double-count
                  // this block exists to prevent, surviving in the AI path only.
                  stateId: { $ifNull: ["$stateId", stateId] },
                  countryId: { $ifNull: ["$countryId", countryId] },
                  sectorType: { $ifNull: ["$sectorType", sectorType] },
                  createdAt: { $ifNull: ["$createdAt", now] },
                  headroomUnits: {
                    // Self-healing base, NOT a bare `$ifNull: [..., 0]`: a pool
                    // doc that predates the `headroomUnits` backfill would
                    // otherwise be wiped to zero by its own first drawdown. See
                    // `unownedHeadroomBaseExpr`.
                    $max: [
                      0,
                      {
                        $subtract: [
                          unownedHeadroomBaseExpr(sectorType, plants?.eraUnitScale ?? 1),
                          units,
                        ],
                      },
                    ],
                  },
                  updatedAt: now,
                },
              },
              // Restate `revenue` FROM the post-draw units instead of subtracting
              // from it independently. Two clamped-at-0 legs moving separately
              // drift apart permanently once either one bottoms out; the shared
              // trailing stage keeps them one quantity in two units.
              { $set: unownedPoolTrailingSet(sectorType, true, plants?.eraUnitScale ?? 1) },
            ],
            upsert: true,
          },
        };
      })
    );
  }

  if (capexRows.length > 0) {
    await emitBuildCapexTxBulk(db, capexRows);
  }

  return {
    corpUpdates,
    sectorUpdates: allSectorUpdates,
    newSectors,
    divestedSectorIds: allDivestedSectorIds,
  };
}

function analyzeSectorProfitability(sectors: CorporateSector[]): SectorProfitInfo[] {
  return sectors.map((sector) => {
    const revenue = sector.revenue ?? 0;
    // Prefer the EFFECTIVE margin — what the sector actually operated at last
    // turn after every modifier — over the seeded `profitMargin`, which is a
    // constant no turn phase ever writes to.
    //
    // Reading the seed meant an NPP always saw 35 (or 12 for an SOE) and so
    // always classified its sectors "strong", even while they were really
    // running at 1.3 or -45. That is why NPP corps never cut growth, never
    // divested and never reacted as they went insolvent: their profitability
    // instrument was frozen at its takeoff value for the entire run.
    const margin = sector.effectiveProfitMargin ?? sector.profitMargin ?? 0;
    const income = revenue * (margin / 100);
    const isProfitable = income > 0;
    const marginCategory: SectorProfitInfo["marginCategory"] =
      margin < 0 ? "loss" : margin < 10 ? "thin" : margin < 25 ? "healthy" : "strong";
    return { sector, income, margin, isProfitable, marginCategory };
  });
}

export function makeNppCorpDecision(
  ctx: NppCorpDecisionContext,
  unownedByCountry: Map<string, UnownedSector[]>,
  stateControlled: ReadonlySet<string>,
  priceRatioOf: CommodityPriceRatioFn,
  plants?: NppPlantsContext,
  placementSignals?: PlacementSignals
): NppCorpDecision {
  const { corp, sectors, now, modifiers } = ctx;
  const updates: Record<string, unknown> = { updatedAt: now };
  const sectorUpdates: NppCorpDecision["sectorUpdates"] = [];
  const newSectors: NppCorpDecision["newSectors"] = [];
  const divestedSectorIds: ObjectId[] = [];
  const unownedDraws: NonNullable<NppCorpDecision["unownedDraws"]> = [];
  const reinvestments: NonNullable<NppCorpDecision["reinvestments"]> = [];

  const liquidCapital = corp.liquidCapital ?? 0;
  // Running balance across the spending sections below (founding, then
  // reinvestment). Both charge the SAME `liquidCapital`, so a section that read
  // the opening balance after another had already committed would let the corp
  // spend the same money twice and land under its own cash floor.
  let cashLocal = liquidCapital;
  const numSectors = sectors.length;

  // ₳ → the corp's own currency. `liquidCapital` is local; every money constant
  // in this module is anchor. See `NppCorpDecisionContext.fxRate`.
  const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corp);
  const corpFxRate = ctx.fxRate ?? 1;
  const toCorpLocal = (amountAnchor: number): number =>
    anchorToCorpCapital(amountAnchor, corpCurrencyCode, corpFxRate);
  const sectorEconomicToCorpLocal = (amount: number, sector: CorporateSector): number => {
    const hostCurrency = resolveSectorHostCurrencyCode(sector, corp);
    const hostRate =
      (hostCurrency && ctx.fxByCurrency?.get(hostCurrency)) ??
      (hostCurrency === corpCurrencyCode ? corpFxRate : 1);
    return toCorpLocal(readCorpEconomicAnchor(amount, hostCurrency, hostRate));
  };

  // Archetype-adjusted levers, each clamped to a safe rail so no personality can
  // bankrupt a profitable corp. Clamped in ₳ (where the rails are authored),
  // then converted once into the currency `liquidCapital` is compared in.
  const effectiveCashFloor = toCorpLocal(
    Math.max(SAFE_CASH_FLOOR_MIN, Math.round(CASH_FLOOR * modifiers.cashFloorMult))
  );
  const effectiveExpansionMinMargin = EXPANSION_MIN_MARGIN * modifiers.expansionMinMarginMult;
  const effectiveExpansionMinCash = toCorpLocal(
    EXPANSION_MIN_CASH * modifiers.expansionMinCashMult
  );

  // ── Profitability analysis ─────────────────────────────────────────────────
  const sectorProfits = analyzeSectorProfitability(sectors);
  const profitableSectors = sectorProfits.filter((sp) => sp.isProfitable).length;

  // `totalIncome`/`totalRevenue`/`corpMargin`/`isProfitable` below feed ONLY
  // sections 3-5 (budgets, dividends, expansion) — never sections 1-2, which
  // read sp.income/sp.margin (nominal, per-sector) directly and are unaffected
  // by this block.
  //
  // Two compounding bugs made those three sections spend a corp into the
  // ground while reading it as healthy the entire time:
  //
  // (1) Blind to its own overhead. The old totalIncome/corpMargin were pure
  //     SECTOR income — before marketing, logistics, R&D and CEO-salary spend,
  //     i.e. before the very overhead section 3 was about to size. So an NPP
  //     read a "healthy" sector margin and kept raising marketing/R&D every
  //     turn, oblivious that its own accumulated overhead was what was
  //     dragging real income to a loss: the margin it re-read next turn never
  //     moved, because nothing ever wrote the overhead back into it. Measured
  //     on a stopped 657-turn world: world-wide totalCosts/revenue rose from
  //     0.49 (turn 2) to 1.19 (turn 657) — 89% of corps loss-making by the end
  //     — while sector-level effectiveProfitMargin held flat in the 45-60
  //     band for a sampled corp across the whole run. The signal genuinely
  //     never moved.
  //
  //     Fix: subtract last turn's ACTUAL marketing+logistics+R&D+CEO-salary
  //     spend (corp.marketingBudget/logisticsBudget/rdBudget/ceoSalary — the
  //     very budgets this section is about to re-decide) from sector income
  //     before judging profitability, so the signal includes the overhead it
  //     drives.
  //
  // (2) Sized off the wrong revenue. `sector.revenue` is NOMINAL (book)
  //     revenue — what a sector would earn if every unit sold at full price.
  //     What the corp actually collects, and what its overhead is actually
  //     paid out of, is `realizedRevenue` (post capacity/price/clearing/
  //     throughput/strike realization) — see sectorTurn.ts's realization
  //     chain. Sizing marketing/logistics/R&D as a % of NOMINAL revenue while
  //     the resulting $ budget is charged against REALIZED revenue silently
  //     multiplies the true overhead burden by 1/realizationRatio: on the
  //     same sampled corp, realizedRevenue ran ~34% of nominal revenue, so a
  //     "sane" 3-5% marketing/logistics/R&D budget was actually landing at
  //     ~9-15% of what the corp truly earned. Sizing off realizedRevenue
  //     instead restores this module's own stated intent — "spend only what
  //     you earn."
  const realizedOrNominal = (sp: SectorProfitInfo) =>
    sectorEconomicToCorpLocal(sp.sector.realizedRevenue ?? sp.sector.revenue ?? 0, sp.sector);
  const totalRevenue = sectorProfits.reduce((sum, sp) => sum + realizedOrNominal(sp), 0);
  const grossRealizedIncome = sectorProfits.reduce(
    (sum, sp) => sum + realizedOrNominal(sp) * (sp.margin / 100),
    0
  );
  const priorOverhead =
    (corp.marketingBudget ?? 0) +
    (corp.logisticsBudget ?? 0) +
    (corp.rdBudget ?? 0) +
    (corp.ceoSalary ?? 0);
  // (3) Blind to its own debt. `priorOverhead` covers what the corp CHOOSES to
  //     spend; it says nothing about what the corp is CONTRACTED to pay. Bond
  //     interest is not discretionary, is often the largest single line on a
  //     levered corp's books, and was entirely absent from this signal, so a
  //     corp could be comfortably operating-profitable and still losing money
  //     every turn with the brain reading it as healthy. See
  //     `NppCorpDecisionContext.debtServiceAnchor` for the measured case.
  //
  //     Charged in the corp's own currency, because `priorOverhead` and
  //     `grossRealizedIncome` are already corp-local and `debtServiceAnchor` is
  //     ₳, the same conversion every other money constant in this module takes.
  const debtServiceLocal = toCorpLocal(ctx.debtServiceAnchor ?? 0);
  const totalIncome = grossRealizedIncome - priorOverhead - debtServiceLocal;
  const corpMargin = totalRevenue > 0 ? (totalIncome / totalRevenue) * 100 : 0;
  const isProfitable = totalIncome > 0 && profitableSectors > 0;

  // ── v5 strategy loop ───────────────────────────────────────────────────────
  // The score is `corpMargin` itself: already currency-normalized, scale-free,
  // and net of both overhead and debt service. One number, comparable across
  // countries and eras, unlike every money constant in this module.
  //
  // Everything below only RE-WEIGHTS levers that already existed. `expand` is
  // the identity, so a corp that is doing fine never changes behaviour.
  const debtDominant = debtServiceLocal > 0 && debtServiceLocal >= grossRealizedIncome;
  const lowFillSectors = sectorProfits.filter(
    (sp) => sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD
  ).length;
  const situation: StrategySituation = {
    score: corpMargin,
    debtDominant,
    // "Mostly cannot sell what it makes": a majority of the corp's sectors.
    chronicLowFill: sectorProfits.length > 0 && lowFillSectors * 2 > sectorProfits.length,
    hasHeadroom: hasEnterableHeadroom(
      corp,
      sectors,
      unownedByCountry,
      stateControlled,
      plants?.enabled === true,
      plants?.eraUnitScale ?? 1
    ),
    // Derived from the corp, NOT passed in. An `isCaretaker` the caller had
    // to remember to set is one more way to get this wrong, which is the
    // exact bug class this module keeps producing: the seeded-margin read,
    // the nominal-revenue read, the unconverted foreign revenue. The corp
    // document already knows.
    isCaretaker: !!corp.caretakerCeo,
  };
  // Absent reads as enabled: see `strategyLoopEnabled`. When off, the corp runs
  // the `expand` levers and no strategy state is written, so an operator can
  // kill the loop mid-world without a revert and without leaving stale memory
  // that would resume the moment it is re-enabled.
  const strategyLoopOn = ctx.strategyLoopEnabled !== false;
  const strategyDecision = strategyLoopOn
    ? advanceStrategy({
        prior: ctx.strategy,
        turn: ctx.turn,
        situation,
        eligible: ctx.strategyEligible === true,
      })
    : null;
  const levers = strategyLevers(strategyDecision?.state.id ?? "expand");

  // ── 1. Divest losing sectors ──────────────────────────────────────────────
  // Divest a losing sector once its margin falls to/below the archetype's
  // tolerance (impatient archetypes shed at the first loss; patient ones tolerate
  // shallow losses) and the corp has other profitable sectors — BUT never divest
  // the corp's primary type (core business).
  if (numSectors > 1) {
    for (const sp of sectorProfits) {
      if (
        sp.income < 0 &&
        sp.margin <= modifiers.divestMarginFloor + levers.divestMarginFloorDelta
      ) {
        // Protect the corp's primary sector type — that's its core business
        if (sp.sector.sectorType === corp.type) continue;

        const remainingProfitable = profitableSectors;
        if (remainingProfitable > 0) {
          divestedSectorIds.push(sp.sector._id);
        }
      }
    }
  }

  // ── 1b. Divest stranded plants (supply-dislocation phase 2) ───────────────
  // A plant that has cleared less than half its output for STRANDED_DIVEST_TURNS
  // straight is built in the wrong place, and margin cannot see it: the units
  // that DO sell carry a healthy margin while most of the output evaporates.
  // Exit it so the corp's next founding (state-aware since P1) rebuilds where
  // the demand is. Same protections as the margin divest — never the corp's
  // core type, never the last sector, only while something else is profitable —
  // plus a one-per-turn cap so exits stay gradual. Capacity is deliberately not
  // restored to the unowned pool: the state is glutted, re-listing the bucket
  // would invite the next founding straight back in.
  if (plants?.enabled && numSectors > 1 && profitableSectors > 0) {
    let strandedDivests = 0;
    // Longest-stranded first, so the cap exits the worst plant.
    const stranded = sectorProfits
      .filter(
        (sp) =>
          (sp.sector.lowFillTurns ?? 0) >= STRANDED_DIVEST_TURNS &&
          sp.sector.sectorType !== corp.type &&
          sp.sector.mothballed !== true &&
          !divestedSectorIds.includes(sp.sector._id)
      )
      .sort((a, b) => (b.sector.lowFillTurns ?? 0) - (a.sector.lowFillTurns ?? 0));
    for (const sp of stranded) {
      if (strandedDivests >= STRANDED_DIVEST_MAX_PER_TURN) break;
      if (numSectors - divestedSectorIds.length <= 1) break;
      divestedSectorIds.push(sp.sector._id);
      strandedDivests += 1;
    }
  }

  // Effective sector count after divestiture
  const effectiveSectors = numSectors - divestedSectorIds.length;

  // ── 2. Growth rate adjustment (per-sector) ────────────────────────────────
  // Aggressive: strong sectors get +2, healthy +1, thin stays, loss -2.
  // Then a macro tilt (smarter-NPP, t879): the margin signal alone floods
  // gluts (a strong-margin sector in a deep glut still accelerated) and
  // starves shortages (a thin sector selling a scarce commodity never grew).
  // Shortage outputs get +1 growth, deep-glut outputs −1, so NPP capacity
  // chases unmet demand instead of pure own-margin momentum.
  for (const sp of sectorProfits) {
    // Skip sectors being divested
    if (divestedSectorIds.includes(sp.sector._id)) continue;
    // A mothballed plant is deliberately idle (section 2c): growth targets are
    // meaningless while it's cold, and its stale margin would only add noise.
    if (sp.sector.mothballed === true) continue;

    // Fill-awareness (t899): lagged soldFraction is only set under clearing
    // mode. A sector that sold < CHRONIC_LOW_FILL_THRESHOLD of its output last
    // turn must not expand — more output would just go unsold. The strategy
    // brain (extractionAutoStrategy pass 2) handles re-pointing it at higher
    // expected revenue; here we only stop it digging deeper.
    const chronicLowFill =
      sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD;

    let targetGrowth = sp.sector.targetGrowthRate ?? 2;

    // Growth must pay for itself. The category ladder below keys on MARGIN, but
    // margin alone does not tell you whether expanding is affordable: growth
    // cost is charged as a share of revenue, so a sector can hold a healthy
    // 25% margin and still lose money once a 21%-of-revenue growth bill lands
    // on top of 75% maintenance. Measured mid-run, that is exactly where firms
    // sat — margin 25, growth cost 21%, income negative — and because 25 reads
    // as "strong" the governor kept ADDING growth every turn, deepening the
    // loss it was supposed to correct.
    //
    // So: never increase growth when the sector's own growth bill already eats
    // its margin, and back off when it clearly exceeds it. A firm with real
    // headroom still expands; one paying more to grow than it earns stops.
    const sectorRevenue = sp.sector.revenue ?? 0;
    const growthCostShare =
      sectorRevenue > 0 ? (100 * (sp.sector.currentGrowthCost ?? 0)) / sectorRevenue : 0;
    // Growth may consume at most HALF the gross margin. Comparing it to the
    // whole margin was too permissive: measured mid-run at margin 27.2 with
    // growth cost 21.4% of revenue, the test passed (21.4 < 27.2) while the
    // firm was plainly losing money — maintenance takes (100 - margin) = 72.8%,
    // so margin plus growth already consumed 94.2% of revenue before any
    // corporate overhead, and average income sat at -13.4k with 67% of firms
    // loss-making. Requiring real headroom is what makes the governor bite: as
    // growth falls its cost falls, so the rule is self-correcting rather than a
    // fixed target.
    const growthUnaffordable = growthCostShare >= sp.margin * GROWTH_COST_MARGIN_SHARE;

    if (growthUnaffordable) {
      targetGrowth = Math.max(0, targetGrowth - 1);
    } else if (sp.marginCategory === "loss") {
      targetGrowth = Math.max(0, targetGrowth - 2);
    } else if (sp.marginCategory === "strong") {
      targetGrowth = Math.min(5, targetGrowth + 2 + modifiers.growthDelta + levers.growthDelta);
    } else if (sp.marginCategory === "healthy") {
      targetGrowth = Math.min(5, targetGrowth + 1 + modifiers.growthDelta + levers.growthDelta);
    }
    // Thin margin → keep current target

    // State-resolution shortage (supply-dislocation P1b): the country blend
    // hid exactly the dislocation this tilt exists to correct — a plant in a
    // glutted state kept growing because OTHER states' shortage pulled the
    // national ratio up. Score the plant's own state, country fallback.
    const shortage = sectorShortageScore(
      sp.sector.sectorType,
      sp.sector.countryId ?? corp.countryId,
      (commodity, cid) =>
        placementSignals?.statePriceRatioOf?.(commodity, sp.sector.stateId) ??
        priceRatioOf(commodity, cid)
    );
    if (shortage >= 1.15 && sp.marginCategory !== "loss" && !growthUnaffordable) {
      targetGrowth = Math.min(5, targetGrowth + 1);
    } else if (shortage <= 0.85) {
      targetGrowth = Math.max(0, targetGrowth - 1);
    }

    // Chronic low fill overrides every upward signal: never grow a sector
    // that can't sell what it already makes.
    if (chronicLowFill) {
      targetGrowth = Math.min(targetGrowth, sp.sector.targetGrowthRate ?? 2, 1);
    }

    if (targetGrowth !== (sp.sector.targetGrowthRate ?? 2)) {
      sectorUpdates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { targetGrowthRate: targetGrowth, updatedAt: now } },
      });
    }
  }

  // ── 2b. Macro-aware production policy ─────────────────────────────────────
  // Ramp output of scarce/premium commodities. Glut response is growth-only
  // (section 2a) — see computeMacroProductionPolicy for why negative policy
  // is forbidden here. Trends 1pt/turn toward the target via the turn engine.
  for (const sp of sectorProfits) {
    if (divestedSectorIds.includes(sp.sector._id)) continue;
    if (sp.sector.mothballed === true) continue;
    const sectorCountryId = sp.sector.countryId ?? corp.countryId;
    let target = computeMacroProductionPolicy(sp.sector.sectorType, sectorCountryId, priceRatioOf);
    if (target == null) continue;
    // Fill-awareness (t899): under chronic low fill, cap the production policy
    // at 0 — a shortage price signal is no reason to ramp output this sector
    // demonstrably cannot sell.
    if (sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD) {
      target = Math.min(target, 0);
    }
    if (target !== (sp.sector.productionPolicy ?? 0)) {
      sectorUpdates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { productionPolicy: target, updatedAt: now } },
      });
    }
  }

  // ── 2c. Glut mothballing (plants only) ────────────────────────────────────
  // Sections 2a/2b only STOP a glutted sector from growing; nothing ever takes
  // existing capacity OFF the market. Under plants that matters: NPP plants
  // seeded at national-economy scale (100k-300k units/day) keep producing
  // full-tilt into markets clearing at soldFraction 0.01-0.08, pinning every
  // finished-good price to the log-curve floor and starving player plants of
  // fill (ticket #1027 — chemicals sat 72x oversupplied, advertising 125x).
  // Negative productionPolicy is the WRONG lever for this (its lean-ops
  // asymmetry cuts input demand harder than output and worsened gluts, GH
  // #3370); mothballing is the right one — a mothballed plant is cold on BOTH
  // sides, so a glutted market loses supply while the extraction inputs it was
  // hoarding (all in shortage, live fertilizers fill 0.1) are released.
  //
  // Deliberately gradual and self-limiting: a corp is only ELIGIBLE for a
  // state change on its stagger slot (see GLUT_STATE_CHANGE_STAGGER — young
  // worlds are wall-to-wall single-sector NPP corps, so per-corp limits alone
  // are cohort-wide cliffs), at most ONE change per corp per turn, and only
  // while the sector's own fill is under GLUT_MOTHBALL_FILL_THRESHOLD — as
  // capacity idles, surviving sellers' fill rises and the trigger stops
  // firing. A single-sector corp MAY go fully cold: the restart pass prices
  // its market without needing fill, so cold is recoverable, and exempting
  // last sectors would exempt essentially the whole glut. Restarts use the
  // price signal with a wide hysteresis band and are preferred over new
  // mothballs so a recovering market reactivates before it sheds more.
  // State-owned corps (countryOwnerId) are exempt: SOEs are policy
  // instruments, not margin-seekers.
  if (
    plants?.enabled &&
    !corp.countryOwnerId &&
    glutStaggerEligible(corp._id.toString(), ctx.turn)
  ) {
    let stateChangeBudget = 1;

    // Restart pass first: recovering markets reactivate before anything sheds.
    for (const sp of sectorProfits) {
      if (stateChangeBudget <= 0) break;
      if (sp.sector.mothballed !== true) continue;
      if (divestedSectorIds.includes(sp.sector._id)) continue;
      const ratio = sectorShortageScore(
        sp.sector.sectorType,
        sp.sector.countryId ?? corp.countryId,
        priceRatioOf
      );
      if (ratio >= GLUT_RESTART_PRICE_RATIO) {
        sectorUpdates.push({
          filter: { _id: sp.sector._id },
          update: { $set: { mothballed: false, updatedAt: now } },
        });
        stateChangeBudget -= 1;
      }
    }

    if (stateChangeBudget > 0) {
      let worst: { sp: SectorProfitInfo; fill: number } | null = null;
      for (const sp of sectorProfits) {
        if (sp.sector.mothballed === true) continue;
        if (divestedSectorIds.includes(sp.sector._id)) continue;
        // Extraction is excluded: every extractable is shortage-side (its
        // fill is ~1 so the gate would never fire) and its output/rationing
        // legs live outside the clearing book this signal reads.
        if (sp.sector.sectorType === "extraction") continue;
        const fill = sp.sector.soldFraction;
        // soldFraction is only written under clearing mode; a sector that
        // has never cleared (mid-build, legacy) is not a candidate.
        if (fill == null || fill >= GLUT_MOTHBALL_FILL_THRESHOLD) continue;
        const ratio = sectorShortageScore(
          sp.sector.sectorType,
          sp.sector.countryId ?? corp.countryId,
          priceRatioOf
        );
        if (ratio > GLUT_MOTHBALL_PRICE_RATIO) continue;
        if (worst == null || fill < worst.fill) worst = { sp, fill };
      }
      if (worst) {
        sectorUpdates.push({
          filter: { _id: worst.sp.sector._id },
          update: { $set: { mothballed: true, updatedAt: now } },
        });
      }
    }
  }

  // ── 2e. Input-squeeze strategy shift ──────────────────────────────────────
  // See the note at STRATEGY_SHIFT_MARGIN_TRIGGER. Runs on the SAME cohort
  // stagger as 2c but independently of its budget: a mothball and a strategy
  // shift never target the same sector (a shift candidate is running and
  // selling; a mothball candidate is unfilled), and only one shift per corp
  // per turn keeps the cohort gradual. SOEs are exempt for 2c's reason.
  if (!corp.countryOwnerId && glutStaggerEligible(corp._id.toString(), ctx.turn)) {
    let best: {
      sp: SectorProfitInfo;
      toStrategyId: string;
      advantage: number;
    } | null = null;
    for (const sp of sectorProfits) {
      const sector = sp.sector;
      if (sector.mothballed === true) continue;
      if (divestedSectorIds.includes(sector._id)) continue;
      if (sector.sectorType === "extraction") continue; // own deposit-aware pass
      // Distressed sectors qualify at the low advantage bar; profitable ones
      // only at the profit-seek bar (checked against `advantage` below).
      const distressed = (sector.effectiveProfitMargin ?? 0) <= STRATEGY_SHIFT_MARGIN_TRIGGER;
      if (
        typeof sector.transitionCooldownUntilTurn === "number" &&
        sector.transitionCooldownUntilTurn > ctx.turn
      ) {
        continue;
      }
      // Mid-transition sectors keep their committed lane.
      if (sector.transitionFromStrategyId) continue;
      const strategies = SECTOR_STRATEGIES[sector.sectorType as CorporationType];
      if (!strategies || strategies.length < 2) continue;
      const sectorCountryId = sector.countryId ?? corp.countryId;
      const currentId = sector.strategyId ?? "standard";
      const current = strategies.find((s) => s.id === currentId);
      if (!current) continue;
      const currentScore = strategyPriceScore(current, sectorCountryId, priceRatioOf);
      if (currentScore == null) continue;
      for (const candidate of strategies) {
        if (candidate.id === currentId) continue;
        // Era/tech gating mirrors the player path exactly.
        const availability = getStrategyAvailability(
          corp,
          candidate,
          ctx.currentYear ?? 0,
          ctx.techTreesEnabled ?? false
        );
        if (availability.locked) continue;
        const score = strategyPriceScore(candidate, sectorCountryId, priceRatioOf);
        if (score == null) continue;
        const advantage = score - currentScore;
        const requiredAdvantage = distressed
          ? STRATEGY_SHIFT_MIN_ADVANTAGE
          : STRATEGY_SHIFT_PROFIT_SEEK_ADVANTAGE;
        if (advantage < requiredAdvantage) continue;
        if (best == null || advantage > best.advantage) {
          best = { sp, toStrategyId: candidate.id, advantage };
        }
      }
    }
    if (best) {
      const sector = best.sp.sector;
      const fromId = sector.strategyId ?? "standard";
      // Same D9 helper as the player command and extraction auto-pass: nameplate
      // stays put and `anchor × units` (physical opex) stays put.
      sectorUpdates.push({
        filter: { _id: sector._id },
        update: {
          $set: {
            strategyId: best.toStrategyId,
            transitionFromStrategyId: fromId,
            transitionStartTurn: ctx.turn,
            transitionCooldownUntilTurn: ctx.turn + STRATEGY_COOLDOWN_TURNS,
            ...retoolRescaleFields({
              sectorType: sector.sectorType as CorporationType,
              fromStrategyId: fromId,
              toStrategyId: best.toStrategyId,
              plantsEnabled: plants?.enabled === true,
              capitalStock: sector.capitalStock,
              buildQueue: sector.buildQueue,
              otherOpexPerUnitAnchor: sector.otherOpexPerUnitAnchor,
            }),
            updatedAt: now,
          },
        },
      });
    }
  }

  // ── 2d. Wage policy (labour wages+) ───────────────────────────────────────
  // Quality, unionization and labour cost all hang off wageLevel. Player CEOs
  // set it; NPP CEOs never did, so every NPP plant sat at the 1.0 baseline
  // even with labourSystemMode full. Shortage + healthy margins pay up for
  // quality; glut or losses cut toward 0.95. Steps 0.02/turn so a shock does
  // not rewrite the wage bill in one tick. Union floors are applied at cost
  // time (collectiveAgreementEffects) and are not written here.
  if (ctx.labourWagesEnabled) {
    for (const sp of sectorProfits) {
      if (divestedSectorIds.includes(sp.sector._id)) continue;
      if (sp.sector.mothballed === true) continue;
      const chronicLowFill =
        sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD;
      const shortage = sectorShortageScore(
        sp.sector.sectorType,
        sp.sector.countryId ?? corp.countryId,
        priceRatioOf
      );
      let target = NPP_WAGE_BASELINE;
      if (chronicLowFill || sp.marginCategory === "loss" || shortage <= 0.85) {
        target = NPP_WAGE_GLUT_TARGET;
      } else if (
        shortage >= 1.15 &&
        (sp.marginCategory === "healthy" || sp.marginCategory === "strong")
      ) {
        target = NPP_WAGE_SHORTAGE_TARGET;
      }
      const current = sp.sector.wageLevel ?? NPP_WAGE_BASELINE;
      const delta = Math.max(-NPP_WAGE_STEP, Math.min(NPP_WAGE_STEP, target - current));
      const next = clampWageLevel(Math.round((current + delta) * 100) / 100);
      if (next !== current) {
        sectorUpdates.push({
          filter: { _id: sp.sector._id },
          update: { $set: { wageLevel: next, updatedAt: now } },
        });
      }
    }
  }

  // ── 3. Budget decisions (revenue-based, not cash-based) ───────────────────
  // Budgets scale on what the corp EARNS, not what it has in the bank.
  // This prevents a cash-rich but unprofitable corp from burning reserves.
  // `totalRevenue`/`corpMargin`/`isProfitable` are the realized-revenue,
  // net-of-overhead figures computed above — see the profitability-analysis
  // block's comment for why gross/nominal figures let this section spend a
  // corp into the ground while reading it as healthy.

  // Base budget shares by margin band, then scaled by archetype (marketing/R&D).
  // Logistics is an operational lever, not a personality one, so it's unscaled.
  let marketingPct: number;
  let logisticsPct: number;
  let rdPct: number;
  if (!isProfitable || totalRevenue === 0) {
    // Losing money: cut everything to minimum
    marketingPct = 0.005;
    logisticsPct = 0.003;
    rdPct = 0;
  } else if (corpMargin < 10) {
    // Thin margins: lean budgets, no R&D
    marketingPct = 0.015;
    logisticsPct = 0.01;
    rdPct = 0;
  } else if (corpMargin < 25) {
    // Healthy margins: moderate investment
    marketingPct = 0.03;
    logisticsPct = 0.02;
    rdPct = 0.01;
  } else {
    // Strong margins: aggressive investment to grow
    marketingPct = 0.05;
    logisticsPct = 0.03;
    rdPct = 0.02;
  }

  const marketingBudget = Math.round(
    totalRevenue * marketingPct * modifiers.marketingMult * levers.marketingMult
  );
  const logisticsBudget = Math.round(totalRevenue * logisticsPct);
  const rdBudget = Math.round(totalRevenue * rdPct * modifiers.rdMult * levers.rdMult);
  if (marketingBudget !== (corp.marketingBudget ?? 0)) updates.marketingBudget = marketingBudget;
  if (logisticsBudget !== (corp.logisticsBudget ?? 0)) updates.logisticsBudget = logisticsBudget;
  if (rdBudget !== (corp.rdBudget ?? 0)) updates.rdBudget = rdBudget;

  // ── 4. Dividend policy ────────────────────────────────────────────────────
  // Only pay dividends when profitable with strong margins AND above cash floor.
  // Rate scales with margin — higher margin = higher payout. isProfitable/
  // corpMargin are net of overhead (see profitability-analysis block above) —
  // a corp whose marketing/logistics/R&D/CEO-salary spend is eating its
  // sector income no longer reads as dividend-eligible just because its
  // sectors look healthy in isolation.
  let targetDividendRate = 0;
  if (isProfitable && liquidCapital > effectiveCashFloor && corpMargin >= 15) {
    if (corpMargin >= 30) targetDividendRate = 8;
    else if (corpMargin >= 20) targetDividendRate = 5;
    else targetDividendRate = 3;
    // Archetype tilts payout vs. reinvestment, clamped to a sane ceiling.
    targetDividendRate = Math.min(
      MAX_DIVIDEND_RATE,
      Math.round(targetDividendRate * modifiers.dividendMult * levers.dividendMult)
    );
  }
  if (targetDividendRate !== (corp.dividendRate ?? 0)) {
    updates.dividendRate = targetDividendRate;
  }

  // ── 5. Sector expansion ───────────────────────────────────────────────────
  // Only expand when profitable, strong margins, ample cash above floor,
  // and under max sectors. Deterministic — no random dice roll. isProfitable/
  // corpMargin are net of overhead — see profitability-analysis block above.
  const surplusCash = liquidCapital - effectiveCashFloor;
  if (
    levers.allowExpansion &&
    effectiveSectors < MAX_SECTORS &&
    isProfitable &&
    corpMargin >= effectiveExpansionMinMargin &&
    surplusCash > effectiveExpansionMinCash
  ) {
    const existingTypes = new Set(sectors.map((s) => s.sectorType));
    const expansion = findBestUnownedSector(
      corp.countryId,
      corp.headquartersState,
      corp.type,
      corp.secondaryType,
      existingTypes,
      unownedByCountry,
      stateControlled,
      priceRatioOf,
      plants?.enabled === true,
      plants?.eraUnitScale ?? 1,
      placementSignals
    );

    if (expansion && plants?.enabled) {
      // ─── Plants: an NPP founds a sector on the SAME terms a player does ────
      //
      // Pre-plants the AI paid a flat EXPANSION_COST (500k) and was handed
      // capacity for free, while a player paid 100k and got the same grant.
      // Under plants capacity is bought, so a free AI grant would be a capacity
      // mint no player can match — and the flat 500k bears no relation to what
      // the plant it conjures is worth. Both sides now price through
      // `computeBuildCost` with the founding discount, and both draw the
      // capacity out of the unowned pool they enter.
      const headroomUnits = unownedHeadroomUnitsOf(
        expansion.sectorType as CorporationType,
        expansion.headroomUnits,
        expansion.revenue,
        plants.eraUnitScale
      );
      // Same one-facility starter a player gets via expandSector / foundingPlant.
      const starterUnits = foundingStarterUnits(expansion.sectorType as CorporationType);
      const buildAnchor =
        starterUnits > 0
          ? computeBuildCost({
              sectorType: expansion.sectorType as CorporationType,
              units: starterUnits,
              year: plants.year,
              eraUnitScale: plants.eraUnitScale,
              // No presence in this bucket yet — dominance is 1 by construction.
              marketSharePercent: 0,
              primeRate: plants.primeRateOf(expansion.countryId),
              // An NPP CEO is an NPP, not a Character, so it has no Business
              // Acumen to read. Neutral is the honest value and matches what
              // `computeBuildCost` assumes for a vacant seat.
              acumen: NEUTRAL_STAT,
              hostCostOfLivingIndex: plants.costOfLivingOf(expansion.stateId),
              founding: true,
            }).totalAnchor
          : 0;
      // Charged in the corp's own currency: fee + build are ₳, liquidCapital is not.
      const entryFeeAnchor = sectorEntryFeeAnchor(plants.preset);
      const foundingCost = toCorpLocal(entryFeeAnchor + buildAnchor);

      // Affordability against the REAL cost. The generic surplus gate above is
      // a flat nominal band and cannot know what a build in this sector costs;
      // without this an NPP would commit to a plant it cannot pay for and drive
      // itself under the cash floor. Also require the market have room for the
      // facility — do not found into a zero-headroom bucket.
      if (
        starterUnits > 0 &&
        headroomUnits >= starterUnits &&
        liquidCapital - foundingCost >= effectiveCashFloor
      ) {
        const buildTurns = Math.max(
          1,
          Math.ceil(CAPACITY_BUILD_TURNS(expansion.sectorType as CorporationType) / 2)
        );
        // Legacy nameplate proportional to the facility share of the pool;
        // plants restates revenue from capacity on the next tick.
        const nameplateShare = headroomUnits > 0 ? Math.min(1, starterUnits / headroomUnits) : 0;
        newSectors.push({
          stateId: expansion.stateId,
          countryId: expansion.countryId,
          sectorType: expansion.sectorType,
          // Written in the corp's own currency, because that is what
          // `sectorTurn` reads it as (`readCorpEconomicAnchor` on the way in,
          // `writeCorpEconomicLocal` on the way out). The unowned pool is ₳,
          // so an unconverted copy made the sector's stored nameplate 1/fx of
          // the value the very next turn would restate it to — a one-turn ×fx
          // step change in every non-anchor currency.
          revenue: Math.round(toCorpLocal(expansion.revenue * nameplateShare)),
          profitMargin: 35,
          starterOrder: {
            unitsOrdered: starterUnits,
            costPaidAnchor: buildAnchor,
            startTurn: ctx.turn,
            onlineTurn: ctx.turn + buildTurns,
            smooth: true,
          },
        });
        unownedDraws.push({
          stateId: expansion.stateId,
          sectorType: expansion.sectorType as CorporationType,
          units: starterUnits,
          countryId: expansion.countryId,
        });
        cashLocal = liquidCapital - foundingCost;
        updates.liquidCapital = cashLocal;
      }
    } else if (expansion) {
      newSectors.push({
        stateId: expansion.stateId,
        countryId: expansion.countryId,
        sectorType: expansion.sectorType,
        revenue: Math.round(expansion.revenue * 0.25),
        profitMargin: 35,
      });
      cashLocal = liquidCapital - toCorpLocal(EXPANSION_COST);
      updates.liquidCapital = cashLocal;
    }
  }

  // ── 6. Capacity reinvestment (plants only) ────────────────────────────────
  //
  // The replacement for the growth-target decision the AI lost under plants.
  // See the NPP_REINVEST_* constants block for the rule, the arithmetic and the
  // calibration. Non-plants worlds skip this block entirely and are byte-
  // identical to before.
  //
  // STATE-OWNED ENTERPRISES ARE EXCLUDED. Everything below is PRIVATE-SECTOR
  // machinery: it rations the build against the corp's own liquid cash
  // (`effectiveCashFloor`, `NPP_REINVEST_MAINTENANCE_CASH_SHARE`) because a
  // private corp's capex is funded out of retained earnings. An SOE's is not —
  // a state enterprise funds capacity from state channels, and its treasury
  // backstop deliberately covers only its OPERATING loss (see
  // `coverableSoeShortfallAnchor`; covering build orders was the P3b exploit).
  // Running an SOE through this path therefore charges it cash the state never
  // gave it and leaves it permanently insolvent. Its channels are instead:
  //   • command economies — the Gosbank directed-credit tranche, floored at one
  //     turn of depreciation replacement (`commandEconomyTurn`);
  //   • every other state-owned corp — the budgeted state capex grant from the
  //     owning treasury (`processSoeOperations`).
  // Note this is the CANONICAL `isStateOwned` reader, not `ownershipState`
  // alone: the seeded NatCorps and the command-economy national enterprises
  // carry `countryOwnerId` and no `ownershipState`, so the old local check saw
  // them as private.
  if (plants?.enabled && !isStateOwned(corp)) {
    // Pool lookup by (state, type), built lazily per country. These are the SAME
    // object references the caller mutates after each corp's draws, so the
    // headroom read here already reflects what earlier corps in this pass took.
    const poolIndexByCountry = new Map<string, Map<string, UnownedSector>>();
    const poolFor = (countryId: string, stateId: string, sectorType: string) => {
      let index = poolIndexByCountry.get(countryId);
      if (!index) {
        index = new Map<string, UnownedSector>();
        for (const us of unownedByCountry.get(countryId) ?? []) {
          index.set(bucketKey(us.stateId, us.sectorType), us);
        }
        poolIndexByCountry.set(countryId, index);
      }
      return index.get(bucketKey(stateId, sectorType)) ?? null;
    };

    type Candidate = {
      sector: CorporateSector;
      units: number;
      /**
       * The part of `units` that is genuine market ENTRY (the growth leg) and
       * must therefore be drawn out of the unowned pool. The replacement leg is
       * deliberately NOT in here — see the sizing block below.
       */
      drawUnits: number;
      fill: number;
      headroomUnits: number;
    };
    const candidates: Candidate[] = [];

    for (const sp of sectorProfits) {
      const sector = sp.sector;
      if (divestedSectorIds.includes(sector._id)) continue;
      // A mothballed plant is deliberately idle — buying it more capacity is the
      // opposite of the decision that mothballed it.
      if (sector.mothballed) continue;
      // Nothing built yet (a newborn founding, or a pre-flip sector still
      // awaiting its transition order): there is no capacity to maintain and no
      // fill telemetry to justify a build.
      const capitalStock = sector.capitalStock ?? 0;
      if (!(capitalStock > 0)) continue;
      // Queue-array ceiling — see the constant for why this is not the
      // rationing dial.
      const queueDepth = sector.buildQueue?.length ?? 0;
      if (queueDepth >= NPP_REINVEST_MAX_QUEUE_DEPTH) continue;

      // (a) Is it selling what it makes? Persisted units telemetry only — no
      // telemetry means no evidence, and no evidence means no build.
      const produced = sector.producedUnits ?? 0;
      const sold = sector.soldUnits ?? 0;
      if (!(produced > 0)) continue;
      const fill = sold / produced;
      if (fill < NPP_REINVEST_MIN_FILL) continue;

      // (b) Is there room in the market to absorb more output? Same unowned
      // pool the founding path sizes and draws against.
      const sectorCountryId = sector.countryId ?? corp.countryId;
      // Don't add private capacity into a bucket a National Corporation runs —
      // the same gate `findBestUnownedSector` applies to expansion. Every corp
      // reaching here is private — state-owned corps returned above — so this
      // no longer needs the SOE carve-out it used to carry.
      if (stateControlled.has(bucketKey(sector.stateId, sector.sectorType))) {
        continue;
      }
      // ─── Headroom is a gate on GROWTH, never on REPLACEMENT ────────────────
      //
      // A bucket an incumbent already fills has ZERO unowned headroom by
      // construction, and nothing ever puts headroom back: depreciation
      // destroys owned capacity without returning it to the pool (see
      // `advanceCapitalStock` in sectorTurn — the stock shrinks, no pool write
      // follows). Gating the whole build on `headroomUnits > 0` therefore
      // blocked reinvestment in exactly the sectors that needed it, forever.
      //
      // Measured on the 96-turn A/B (`ab4_plants`, turn 135): 128 of 3,842 pool
      // rows sat at zero headroom, and those rows covered 391 of the 1,006
      // owned sectors — 237 of the 238 NPP sectors that passed every other gate
      // were refused here. That is the whole "zero builds in a 96-turn world".
      //
      // The split below is the accounting that makes both legs honest:
      //   • REPLACEMENT (δ) — buying back capacity that already existed in this
      //     market and wore out. World capacity is not increased, so it needs no
      //     headroom and draws nothing from the pool. It is the netted form of
      //     "depreciation frees headroom, the rebuild consumes it again".
      //   • GROWTH (g) — genuine new capacity. Headroom-gated, clamped to a
      //     quarter of the pool and drawn out of it, exactly as founding is.
      // It also matches the player path: `buildCapacity` (a top-up) is not
      // headroom-gated at all, while `expandSector` (an entry) draws the pool.
      const pool = poolFor(sectorCountryId, sector.stateId, sector.sectorType);
      const headroomUnits = pool
        ? unownedHeadroomUnitsOf(
            sector.sectorType,
            pool.headroomUnits,
            pool.revenue,
            plants.eraUnitScale
          )
        : 0;

      // Sizing: replace depreciation, plus the growth the corp's own
      // targetGrowthRate just asked for, scaled by how convincingly the sector
      // is selling out. `targetGrowthRate` is % per game YEAR.
      const targetGrowthRate = Math.max(0, sector.targetGrowthRate ?? 0);
      const growthPerTurn = targetGrowthRate / 100 / TURNS_PER_YEAR;
      // fill = MIN_FILL ⇒ 0.5×, fill = 1 (sold out) ⇒ 1×. A sector that is only
      // just clearing its output gets a half-sized build, not zero: it still
      // has to replace what wore out.
      const fillScale =
        0.5 +
        0.5 *
          Math.min(1, Math.max(0, (fill - NPP_REINVEST_MIN_FILL) / (1 - NPP_REINVEST_MIN_FILL)));
      // Replacement is sized off the capacity the plant actually RUNS, not off
      // its nameplate. Under plants a sector's output is throughput- and
      // clearing-bound (measured median utilization 0.85 against 0.996 in the
      // capital arm), so the idle remainder is capacity the corp is already
      // paying IDLE_UPKEEP_FRACTION on for nothing — worth ~4.9 points of
      // margin at the A/B's median. Replacing the nameplate would buy that idle
      // share back every turn in perpetuity; replacing the RUN capacity lets it
      // depreciate away and the plant converges on the size it can actually
      // sell.
      const runUnits = Math.max(0, Math.min(capitalStock, sector.producedUnits ?? 0));
      // ACCRUAL, not a per-turn slice. A build lands `CAPACITY_BUILD_TURNS`
      // turns after it is placed, and the queue ceiling can stop the corp
      // ordering for a stretch; sizing each order off the depreciation that has
      // accrued since the LAST order makes the capacity bought independent of
      // how often the corp got to order. Capped at one build cycle so a sector
      // that has never ordered (or whose queue just emptied after a long gap)
      // cannot place a giant catch-up build.
      const buildCycle = Math.max(1, CAPACITY_BUILD_TURNS(sector.sectorType));
      const lastOrderTurn = (sector.buildQueue ?? []).reduce(
        (latest, o) => (Number.isFinite(o.startTurn) ? Math.max(latest, o.startTurn) : latest),
        Number.NEGATIVE_INFINITY
      );
      const accrualTurns = Number.isFinite(lastOrderTurn)
        ? Math.min(buildCycle, Math.max(0, ctx.turn - lastOrderTurn))
        : 1;
      // Stranded-plant decay (supply-dislocation P1b): in a state whose own
      // market is deep-glut for this sector's outputs, replace only half of
      // what wears out. Full replacement held every misplaced plant at its
      // built size forever; half lets it shrink toward what its state can
      // absorb while a plant in a starved state replaces in full. Growth is
      // already state-tilted via targetGrowthRate (section 2a).
      const stateShortage = sectorShortageScore(
        sector.sectorType,
        sectorCountryId,
        (commodity, cid) =>
          placementSignals?.statePriceRatioOf?.(commodity, sector.stateId) ??
          priceRatioOf(commodity, cid)
      );
      const strandedDecayScale = stateShortage <= 0.85 ? 0.5 : 1;
      const replacementUnits =
        runUnits *
        CAPITAL_DEPRECIATION_PER_TURN *
        accrualTurns *
        fillScale *
        strandedDecayScale *
        NPP_REINVEST_AGGRESSION;
      const growthWanted =
        !levers.allowGrowthCapex || queueDepth >= NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH
          ? 0
          : capitalStock * growthPerTurn * fillScale * NPP_REINVEST_AGGRESSION;
      // The pool clamp applies to the growth leg alone — it is the only leg that
      // consumes unmet demand.
      const growthUnits = Math.max(
        0,
        Math.min(growthWanted, headroomUnits * NPP_REINVEST_HEADROOM_SHARE)
      );
      const units = replacementUnits + growthUnits;
      if (!(units > 0)) continue;

      candidates.push({ sector, units, drawUnits: growthUnits, fill, headroomUnits });
    }

    // Best first: the sector selling hardest into the deepest unmet demand. The
    // build's own size is in the key because headroom is legitimately ZERO in a
    // bucket an incumbent fills, and ranking on headroom alone made every
    // replacement-only candidate tie at 0 — the corp would then always pick
    // whichever sector the driver happened to return first.
    candidates.sort(
      (a, b) => b.fill * (b.headroomUnits + b.units) - a.fill * (a.headroomUnits + a.units)
    );

    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= NPP_REINVEST_MAX_SECTORS_PER_TURN) break;
      const { sector, units } = candidate;

      // Dominance is priced off the corp's own footprint in this bucket: its
      // capacity against that plus the headroom still unowned. A dominant
      // incumbent pays more to add capacity, exactly as a player does.
      const capitalStock = sector.capitalStock ?? 0;
      const bucketTotal = capitalStock + candidate.headroomUnits;
      const marketSharePercent = bucketTotal > 0 ? (100 * capitalStock) / bucketTotal : 0;

      const costAnchor = computeBuildCost({
        sectorType: sector.sectorType,
        units,
        year: plants.year,
        eraUnitScale: plants.eraUnitScale,
        marketSharePercent,
        primeRate: plants.primeRateOf(sector.countryId ?? corp.countryId),
        // An NPP CEO is an NPP, not a Character — no Business Acumen to read.
        acumen: NEUTRAL_STAT,
        hostCostOfLivingIndex: plants.costOfLivingOf(sector.stateId),
        // NOT a founding build: this plant already exists, so the founding
        // discount does not apply. An NPP topping up capacity pays the same
        // list price a player pays through `buildCapacity`.
        founding: false,
      }).totalAnchor;
      const costLocal = toCorpLocal(costAnchor);

      // Affordability. Nobody builds free — this is also the SOE capex
      // discipline: a state enterprise pays cash for its builds like anyone
      // else, and the CIP it creates is what the remittance pass amortizes
      // (CAPEX_AMORTIZATION_PER_TURN) instead of being swept to the treasury.
      //
      // Two rails, because the two legs are different decisions. A build with a
      // GROWTH leg is a discretionary bet and faces the same entry floor the
      // founding path uses. A REPLACEMENT-ONLY build is maintenance, and is
      // rationed as a share of cash instead — see
      // NPP_REINVEST_MAINTENANCE_CASH_SHARE for why the entry floor applied to
      // maintenance is a death spiral rather than prudence.
      if (!(costLocal > 0)) continue;
      const affordable =
        candidate.drawUnits > 0
          ? cashLocal - costLocal >= effectiveCashFloor
          : costLocal <= Math.max(0, cashLocal) * NPP_REINVEST_MAINTENANCE_CASH_SHARE &&
            cashLocal - costLocal > 0;
      if (!affordable) continue;

      const buildTurns = Math.max(1, CAPACITY_BUILD_TURNS(sector.sectorType));
      const order: SectorBuildOrder = {
        unitsOrdered: units,
        costPaidAnchor: costAnchor,
        startTurn: ctx.turn,
        onlineTurn: ctx.turn + buildTurns,
        smooth: true,
      };
      // ─── The queue write is a DELTA, never a whole-array `$set` ───────────
      //
      // `sector.buildQueue` is a snapshot read at the top of this turn phase.
      // A `$set` of the recomputed array would land AFTER `sectorTurn`'s own
      // `$pull` of the orders that completed this turn (bulkWrite is ordered,
      // and the NPP ops are appended last), resurrecting every landed order —
      // the capacity would be delivered again on the next tick. It would also
      // erase any order a player CEO placed during the phase. `$push` + `$inc`
      // touch only what this decision actually owns, and compose with both.
      // Same rule, same reason as `sectorTurn`'s C4 note.
      sectorUpdates.push({
        filter: { _id: sector._id },
        update: {
          $set: { updatedAt: now },
          $push: { buildQueue: order },
          $inc: { constructionInProgressAnchor: Math.round(costAnchor) },
        },
      });
      // Conservation: NEW capacity is capacity taken OUT of the unowned pool,
      // exactly as founding does. Minting it here would double-count the same
      // demand as both owned capacity and unowned headroom. The replacement leg
      // is excluded on purpose — it buys back capacity that was already owned
      // and never returned to the pool when it depreciated, so drawing for it
      // would charge the market twice for one unit of demand.
      if (candidate.drawUnits > 0) {
        unownedDraws.push({
          stateId: sector.stateId,
          sectorType: sector.sectorType,
          units: candidate.drawUnits,
          countryId: sector.countryId ?? corp.countryId,
        });
      }
      cashLocal -= costLocal;
      updates.liquidCapital = cashLocal;
      reinvestments.push({
        sectorId: sector._id,
        sectorType: sector.sectorType,
        units,
        costAnchor,
        costLocal,
        onlineTurn: order.onlineTurn,
      });
      placed += 1;
    }
  }

  return {
    corpId: corp._id,
    updates,
    sectorUpdates,
    newSectors: newSectors.length > 0 ? newSectors : undefined,
    divestedSectorIds: divestedSectorIds.length > 0 ? divestedSectorIds : undefined,
    unownedDraws: unownedDraws.length > 0 ? unownedDraws : undefined,
    reinvestments: reinvestments.length > 0 ? reinvestments : undefined,
    strategy: strategyDecision?.state,
  };
}
