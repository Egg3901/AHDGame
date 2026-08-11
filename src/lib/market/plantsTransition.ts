/**
 * PLANTS TRANSITION — the operational layer around the tier flip.
 *
 * The plants engine itself is merged and mode-gated. What this module adds is
 * the part an operator needs on the day: a preflight that predicts what the
 * flip will do BEFORE it happens, and a soak summary that says whether the
 * world that came out the other side is behaving.
 *
 * Everything here is PURE — no Mongo, no io, no clock. The scripts in
 * `scripts/ops/` are thin readers that load documents, hand them to these
 * functions, and print the result. That split is the point: the reporting
 * logic (which is where the arithmetic mistakes live) is unit-testable without
 * a live database, and the same functions can be pointed at a sim world, a
 * sandbox, or prod without change.
 *
 * The predictions here deliberately re-use the ENGINE's own primitives —
 * `impliedOutputUnits`, `CAPITAL_SEED_HEADROOM`, `capacityPricePerUnit`,
 * `getEffectiveStrategyRates` — rather than reimplementing the flip formulas.
 * A preflight that predicts the flip using its own copy of the maths is a
 * preflight that can pass while the engine does something else.
 *
 * Currency: every `*Anchor` figure is in ₳. Sector documents store money in
 * their host currency, so the CALLER converts to ₳ before handing rows in
 * (`readCorpEconomicAnchor`). Mixing a local figure into these inputs would
 * reproduce the t841 class of bug — see the nationalization money-safety notes.
 */
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  capacityPricePerUnit,
} from "@/lib/constants/capacityEconomy";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES, getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { CAPITAL_SEED_HEADROOM, impliedOutputUnits } from "@/lib/market/capital";
import { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * Rank comparison over the tier ladder.
 *
 * `marketAtLeast` lives in `featureFlag.ts`, which is server-only (it reads
 * Mongo). Importing it here would drag a database dependency into a module
 * whose entire value is being pure. The order array is the shared source of
 * truth both copies read, so they cannot disagree.
 */
function modeAtLeast(mode: MarketSystemMode, tier: MarketSystemMode): boolean {
  return MARKET_MODE_ORDER.indexOf(mode) >= MARKET_MODE_ORDER.indexOf(tier);
}

/** One outstanding capacity build order, as stored on a sector. */
export interface PlantsBuildOrderInput {
  unitsOrdered: number;
  costPaidAnchor: number;
  startTurn: number;
  onlineTurn: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * World-supply step tolerances for the flip, as a fraction of pre-flip supply.
 *
 * The flip is not supply-neutral. `seedCapitalStock` seeds a migrating sector
 * at `impliedUnits × CAPITAL_SEED_HEADROOM` (1.1), and the plants nameplate is
 * restated as `capacity × mixPrice` — so a sector arriving WITHOUT usable
 * stored capacity has its nameplate, and therefore its contribution to world
 * commodity supply, step up by up to 10% on the flip turn. That write is not
 * governed: the λ ramp softens realized revenue, not the nameplate.
 *
 * A world coming from `capital` has real `capitalStock` on most sectors, which
 * wins the `max()`, so the aggregate step should be small. A world coming from
 * `clearing` or below has none, and every sector takes the full headroom step
 * at once — a ~10% world supply shock on a single turn, which will move every
 * commodity price. That is the number these thresholds exist to catch.
 */
export const PLANTS_SUPPLY_STEP_WARN_PCT = 0.02;
export const PLANTS_SUPPLY_STEP_BLOCK_PCT = 0.05;

/**
 * Soak alarm: how far derived plants revenue may drift from the capital-mode
 * counterfactual (`legacyRevenueShadow`) before the operator should care.
 *
 * Drift is EXPECTED and is the entire point of the tier — plants stops the
 * nameplate compounding, so the shadow (which keeps compounding) pulls ahead
 * over time and the gap widens on its own. What matters is the RATE. A world
 * whose drift jumps double digits inside a handful of turns is not diverging,
 * it is broken.
 */
export const PLANTS_SHADOW_DRIFT_WARN_PCT = 0.1;
export const PLANTS_SHADOW_DRIFT_ALARM_PCT = 0.25;

/** Fraction of sectors producing nothing before the world is considered stalled. */
export const PLANTS_ZERO_PRODUCTION_WARN_PCT = 0.05;
export const PLANTS_ZERO_PRODUCTION_ALARM_PCT = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// Preflight — per sector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The sector fields the preflight reads. Structural, so a lean Mongo
 * projection satisfies it, and money is already in ₳ (see the module header).
 */
export interface PlantsPreflightSectorInput {
  id: string;
  corporationId?: string | null;
  sectorType: CorporationType;
  stateId?: string | null;
  countryId?: string | null;
  /** Pre-flip nameplate revenue, ₳ per turn-basis, as stored. */
  revenueAnchor: number;
  /** Accrued daily growth spend, ₳ — the basis for the build credit. */
  currentGrowthCostAnchor?: number | null;
  capitalStock?: number | null;
  strategyId?: string | null;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  /** Non-null means this sector has ALREADY taken its flip turn. */
  plantsStartTurn?: number | null;
  buildQueue?: readonly PlantsBuildOrderInput[] | null;
  constructionInProgressAnchor?: number | null;
  mothballed?: boolean | null;
}

/**
 * A condition that makes the flip UNSAFE for a sector — the flip identity or
 * the derived-revenue chain would produce a nonsense number, not merely a
 * surprising one. Any blocker anywhere is a NO-GO.
 */
export type PlantsPreflightBlocker =
  /** Revenue is negative, NaN or Infinity. The nameplate restatement propagates it. */
  | "revenue-not-finite-or-negative"
  /**
   * The sector's output mix prices to nothing (`impliedUnits === 0`) while it
   * still books revenue. `plantsMixPrice` is then 0, the nameplate restatement
   * is skipped, and capacity NEVER binds output for this sector — it silently
   * keeps behaving like a pre-plants sector forever.
   */
  | "no-priced-output-mix"
  /**
   * Already migrated (`plantsStartTurn` set) but carries no usable capacity
   * while still booking revenue. The seed arm only runs on the flip turn, so
   * nothing will ever restore this sector's capacity: it produces 0 units and
   * its derived revenue collapses to 0 the moment the governor ramp completes.
   */
  | "migrated-without-capacity";

/**
 * A condition worth an operator's attention that does not, by itself, make the
 * flip wrong. Warnings never veto; they go in the report so nobody is surprised.
 */
export type PlantsPreflightWarning =
  /** `strategyId` is not a strategy this sector type has. `getStrategy` falls back to the first one SILENTLY, so the sector will flip on a different output recipe than its document claims. */
  | "unknown-strategy-silent-fallback"
  /** `plantsStartTurn` is set on a world that is not in plants — a leftover from a previous flip or a rollback that did not unset it. The sector will NOT re-run its seed arm. */
  | "stale-plants-start-turn"
  /** Mothballed before the flip: it migrates, then immediately produces 0. */
  | "mothballed-at-flip"
  /** Denormalized CIP disagrees with the sum over the live build queue. */
  | "cip-out-of-sync"
  /** The 1.1x headroom rule steps this sector's nameplate up on the flip turn. */
  | "nameplate-steps-on-headroom";

/** What the flip is predicted to do to ONE sector. */
export interface PlantsPreflightSectorAssessment {
  id: string;
  corporationId: string | null;
  sectorType: CorporationType;
  /** False when `plantsStartTurn` is already set — this sector will not migrate. */
  willMigrate: boolean;
  /** The nameplate as it stands today, ₳ — the baseline the step is measured from. */
  currentRevenueAnchor: number;
  /** `Σ revenue × rate_c / basePrice_c` — the units the nameplate implies. */
  impliedUnits: number;
  /** Usable stored capacity (`capitalStock` when > 0, else 0). */
  storedCapacity: number;
  /** `impliedUnits × CAPITAL_SEED_HEADROOM`. */
  seedCapacity: number;
  /** `max(stored, seed)` on a migrating sector; `stored` otherwise. */
  predictedCapacity: number;
  /** `revenueAnchor / impliedUnits` — 0 when the mix prices to nothing. */
  mixPriceAnchor: number;
  /** `predictedCapacity × mixPrice`, i.e. the restated nameplate. */
  predictedRevenueAnchor: number;
  /** `predicted − current`. Positive means the flip ADDS world supply. */
  revenueDeltaAnchor: number;
  /** Per-commodity supply units the delta implies. */
  supplyDeltaUnits: Partial<Record<CommodityType, number>>;
  /** Units of free build credit the in-flight growth ramp converts into. */
  buildCreditUnits: number;
  /** The ₳ of accrued growth spend that credit honours. */
  buildCreditBasisAnchor: number;
  /** The turn that credit lands and becomes capacity, or null when there is none. */
  buildCreditLandsOnTurn: number | null;
  /** Outstanding (not-yet-online) orders and their paid cost. */
  outstandingBuildOrders: number;
  outstandingBuildUnits: number;
  computedCipAnchor: number;
  storedCipAnchor: number;
  blockers: PlantsPreflightBlocker[];
  warnings: PlantsPreflightWarning[];
}

export interface PlantsPreflightContext {
  currentTurn: number;
  /** In-game year, for era capacity pricing. Falls back to the anchor year. */
  currentYear?: number | null;
  /** Overridable for tests; defaults to the engine's live table. */
  basePrices?: Record<CommodityType, number>;
  /** The world's era unit-basis scale (`getEraUnitScale(preset)`). Absent ⇒ 1 (modern). */
  eraUnitScale?: number;
}

/**
 * Predict the flip for one sector.
 *
 * Mirrors `sectorTurn`'s flip arm step for step (see the module header on why
 * it re-uses the engine primitives rather than restating the formulas).
 */
export function assessPlantsFlipForSector(
  sector: PlantsPreflightSectorInput,
  ctx: PlantsPreflightContext
): PlantsPreflightSectorAssessment {
  const basePrices = ctx.basePrices ?? COMMODITY_BASE_PRICES;
  const blockers: PlantsPreflightBlocker[] = [];
  const warnings: PlantsPreflightWarning[] = [];

  const revenue = sector.revenueAnchor;
  const revenueUsable = Number.isFinite(revenue) && revenue >= 0;
  if (!revenueUsable) blockers.push("revenue-not-finite-or-negative");
  const safeRevenue = revenueUsable ? revenue : 0;

  // `plantsStartTurn == null` — NOT "capitalStock missing" — is the engine's
  // own migration predicate (`isFlipTurn`). A sector can carry capital stock
  // from capital mode and still be un-migrated.
  const willMigrate = sector.plantsStartTurn == null;

  const strategyId = sector.strategyId ?? "standard";
  const known = (SECTOR_STRATEGIES[sector.sectorType] ?? []).some((s) => s.id === strategyId);
  if (!known) warnings.push("unknown-strategy-silent-fallback");

  const rates = getEffectiveStrategyRates(
    sector.sectorType,
    strategyId,
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    ctx.currentTurn
  );
  const supplyRates = rates.supply ?? {};

  const impliedUnits = impliedOutputUnits(
    safeRevenue,
    supplyRates,
    basePrices,
    ctx.eraUnitScale ?? 1
  );
  const storedCapacity =
    typeof sector.capitalStock === "number" && sector.capitalStock > 0 ? sector.capitalStock : 0;
  const seedCapacity = impliedUnits * CAPITAL_SEED_HEADROOM;
  const predictedCapacity = willMigrate ? Math.max(storedCapacity, seedCapacity) : storedCapacity;

  const mixPriceAnchor = impliedUnits > 0 ? safeRevenue / impliedUnits : 0;
  // The engine falls back to the un-restated revenue when the mix prices to
  // nothing, so the prediction does too — and flags it, because that fallback
  // is precisely the state in which capacity never binds.
  const predictedRevenueAnchor =
    mixPriceAnchor > 0 ? predictedCapacity * mixPriceAnchor : safeRevenue;
  if (mixPriceAnchor <= 0 && safeRevenue > 0) blockers.push("no-priced-output-mix");
  if (!willMigrate && storedCapacity <= 0 && safeRevenue > 0) {
    blockers.push("migrated-without-capacity");
  }

  const revenueDeltaAnchor = predictedRevenueAnchor - safeRevenue;
  if (willMigrate && seedCapacity > storedCapacity && revenueDeltaAnchor > 0) {
    warnings.push("nameplate-steps-on-headroom");
  }

  // Supply is `revenue × rate / basePrice` per commodity, so the supply delta
  // is the revenue delta pushed through the same mix.
  const supplyDeltaUnits: Partial<Record<CommodityType, number>> = {};
  for (const [commodity, rate] of Object.entries(supplyRates)) {
    const base = basePrices[commodity as CommodityType];
    if (!Number.isFinite(base) || !base || !Number.isFinite(rate as number)) continue;
    supplyDeltaUnits[commodity as CommodityType] = (revenueDeltaAnchor * (rate as number)) / base;
  }

  // Growth-ramp → build credit. Keys on the ACCRUED COST, matching the engine
  // (a player who already wound the slider back is still owed the capacity
  // they were billed for).
  const growthCostAnchor =
    typeof sector.currentGrowthCostAnchor === "number" &&
    Number.isFinite(sector.currentGrowthCostAnchor)
      ? Math.max(0, sector.currentGrowthCostAnchor)
      : 0;
  const unitPriceAnchor = capacityPricePerUnit(
    sector.sectorType,
    ctx.currentYear ?? CAPACITY_ANCHOR_YEAR,
    ctx.eraUnitScale ?? 1
  );
  const creditApplies = willMigrate && growthCostAnchor > 0 && unitPriceAnchor > 0;
  const buildCreditUnits = creditApplies ? growthCostAnchor / unitPriceAnchor : 0;
  const buildCreditLandsOnTurn = creditApplies
    ? ctx.currentTurn + Math.ceil(CAPACITY_BUILD_TURNS(sector.sectorType) / 2)
    : null;

  const queue = (sector.buildQueue ?? []).filter(
    (o) =>
      o != null && Number.isFinite(o.unitsOrdered) && o.unitsOrdered > 0 && o.onlineTurn != null
  );
  const outstanding = queue.filter((o) => o.onlineTurn > ctx.currentTurn);
  const computedCipAnchor = outstanding.reduce(
    (sum, o) => sum + (Number.isFinite(o.costPaidAnchor) ? Math.max(0, o.costPaidAnchor) : 0),
    0
  );
  const storedCipAnchor =
    typeof sector.constructionInProgressAnchor === "number" &&
    Number.isFinite(sector.constructionInProgressAnchor)
      ? sector.constructionInProgressAnchor
      : 0;
  // Rounded comparison: the turn writes CIP as a rounded `$inc` delta, so
  // sub-unit disagreement is expected bookkeeping, not drift.
  if (Math.round(computedCipAnchor) !== Math.round(storedCipAnchor)) {
    warnings.push("cip-out-of-sync");
  }

  if (sector.mothballed === true) warnings.push("mothballed-at-flip");
  if (!willMigrate) warnings.push("stale-plants-start-turn");

  return {
    id: sector.id,
    corporationId: sector.corporationId ?? null,
    sectorType: sector.sectorType,
    willMigrate,
    currentRevenueAnchor: safeRevenue,
    impliedUnits,
    storedCapacity,
    seedCapacity,
    predictedCapacity,
    mixPriceAnchor,
    predictedRevenueAnchor,
    revenueDeltaAnchor,
    supplyDeltaUnits,
    buildCreditUnits,
    buildCreditBasisAnchor: creditApplies ? growthCostAnchor : 0,
    buildCreditLandsOnTurn,
    outstandingBuildOrders: outstanding.length,
    outstandingBuildUnits: outstanding.reduce((s, o) => s + o.unitsOrdered, 0),
    computedCipAnchor,
    storedCipAnchor,
    blockers,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Preflight — world
// ─────────────────────────────────────────────────────────────────────────────

/** Non-sector readiness facts the script gathers from the db. */
export interface PlantsPreflightWorldInput {
  currentMode: MarketSystemMode;
  currentTurn: number;
  currentYear: number | null;
  assessments: readonly PlantsPreflightSectorAssessment[];
  unowned: {
    total: number;
    /** Docs still lacking `headroomUnits` — the plants-mode leading field. */
    missingHeadroomUnits: number;
    /** Whether `2026-08-01-backfill-unowned-headroom-units` has a marker. */
    backfillMigrationRan: boolean;
  };
  crises: {
    /** Active crisis effects whose `physicality` is explicitly "financial". */
    financialOnly: number;
    /** Active crisis effects with NO `physicality` — legacy snapshots, treated as financial. */
    legacyUnflagged: number;
  };
  governor: { cap: number; rampTurns: number };
  /**
   * Operator override: accept a predicted world-supply step up to this
   * fraction without it counting as a NO-GO. Defaults to the block threshold.
   */
  acceptSupplyStepPct?: number;
}

export interface PlantsPreflightReport {
  verdict: "GO" | "NO-GO";
  /** Human-readable NO-GO reasons. Empty on GO. */
  reasons: string[];
  /** Non-blocking observations worth reading before flipping. */
  cautions: string[];
  mode: { current: MarketSystemMode; alreadyAtPlants: boolean };
  turn: number;
  year: number | null;
  governor: { cap: number; rampTurns: number };
  sectors: {
    total: number;
    willMigrate: number;
    alreadyMigrated: number;
    missingCapitalStock: number;
    steppingOnHeadroom: number;
    mothballed: number;
    withBlockers: number;
    withWarnings: number;
    blockerCounts: Record<string, number>;
    warningCounts: Record<string, number>;
  };
  supply: {
    preFlipRevenueAnchor: number;
    postFlipRevenueAnchor: number;
    deltaAnchor: number;
    deltaPct: number;
    /** Per-commodity unit delta, largest absolute first. */
    byCommodity: { commodity: CommodityType; deltaUnits: number }[];
  };
  buildCredit: {
    sectors: number;
    units: number;
    basisAnchor: number;
    /** Turn range over which the credited capacity lands — the second supply wave. */
    landsBetweenTurns: [number, number] | null;
  };
  cip: { sectorsWithOutstanding: number; outstandingOrders: number; totalAnchor: number };
  unowned: PlantsPreflightWorldInput["unowned"];
  crises: PlantsPreflightWorldInput["crises"];
  /** The worst offenders, for the human-readable report. */
  worstBlockers: PlantsPreflightSectorAssessment[];
  biggestSteps: PlantsPreflightSectorAssessment[];
}

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** Fold per-sector assessments plus world facts into a GO/NO-GO. */
export function buildPlantsPreflightReport(
  input: PlantsPreflightWorldInput
): PlantsPreflightReport {
  const { assessments } = input;
  const reasons: string[] = [];
  const cautions: string[] = [];

  const alreadyAtPlants = modeAtLeast(input.currentMode, "plants");
  if (alreadyAtPlants) {
    // Not a safety failure so much as a category error: there is nothing to
    // preflight, and the numbers below describe a flip that already happened.
    reasons.push(
      `World is already at "${input.currentMode}". A preflight predicts a flip that has not happened yet; ` +
        `use scripts/ops/plantsWatch.ts for a world already in plants.`
    );
  }

  // A world with no sectors is not a clean world, it is almost certainly the
  // wrong database. Every check below is a filter over `assessments`, so an
  // empty set passes all of them and reports a confident GO — the single most
  // dangerous output this tool could produce, because it looks like success.
  // Refuse instead.
  if (assessments.length === 0) {
    reasons.push(
      "No corporate sectors found. A preflight over an empty world passes every check vacuously; " +
        "this is far more likely to be the wrong MONGODB_URI than a world genuinely ready to flip."
    );
  }

  const withBlockers = assessments.filter((a) => a.blockers.length > 0);
  const blockerCounts = tally(assessments.flatMap((a) => a.blockers));
  const warningCounts = tally(assessments.flatMap((a) => a.warnings));
  if (withBlockers.length > 0) {
    reasons.push(
      `${withBlockers.length} sector(s) carry data the flip identity cannot survive: ` +
        Object.entries(blockerCounts)
          .map(([k, n]) => `${k}×${n}`)
          .join(", ")
    );
  }

  const preFlip = assessments.reduce((s, a) => s + a.currentRevenueAnchor, 0);
  const postFlip = assessments.reduce((s, a) => s + a.predictedRevenueAnchor, 0);
  const deltaAnchor = postFlip - preFlip;
  const deltaPct = preFlip > 0 ? deltaAnchor / preFlip : 0;

  const acceptPct = input.acceptSupplyStepPct ?? PLANTS_SUPPLY_STEP_BLOCK_PCT;
  if (Math.abs(deltaPct) > acceptPct) {
    reasons.push(
      `Predicted world-supply step is ${(deltaPct * 100).toFixed(2)}%, above the accepted ` +
        `${(acceptPct * 100).toFixed(2)}%. Every commodity price will move on the flip turn. ` +
        `Flipping from a tier below "capital" (no stored capitalStock) makes the full 1.1x headroom step land at once.`
    );
  } else if (Math.abs(deltaPct) > PLANTS_SUPPLY_STEP_WARN_PCT) {
    cautions.push(
      `World-supply step of ${(deltaPct * 100).toFixed(2)}% is above the ${(
        PLANTS_SUPPLY_STEP_WARN_PCT * 100
      ).toFixed(2)}% comfort line — expect visible commodity price movement on the flip turn.`
    );
  }

  if (input.unowned.missingHeadroomUnits > 0) {
    // The unowned pool's leading field switches to `headroomUnits` under
    // plants. Docs without it read as zero headroom: the pool stops absorbing
    // and releasing capacity correctly the moment the tier changes.
    reasons.push(
      `${input.unowned.missingHeadroomUnits} of ${input.unowned.total} unownedSectors have no headroomUnits. ` +
        `Run the 2026-08-01-backfill-unowned-headroom-units migration first` +
        (input.unowned.backfillMigrationRan
          ? " (its marker EXISTS, so it ran and left these behind — investigate before flipping)."
          : " (no marker — it has not run).")
    );
  } else if (!input.unowned.backfillMigrationRan && input.unowned.total > 0) {
    cautions.push(
      "Every unownedSector has headroomUnits but the backfill migration has no marker — " +
        "likely seeded rather than backfilled. Harmless, but the marker will not stop a later re-run."
    );
  }

  if (input.crises.legacyUnflagged > 0) {
    cautions.push(
      `${input.crises.legacyUnflagged} active crisis effect(s) carry no \`physicality\` flag and are therefore ` +
        `treated as FINANCIAL (margin-only). They will NOT reduce physical output under plants, so a disaster ` +
        `that predates the flip stops biting production the moment the tier changes. Expected; noted so it is not a surprise.`
    );
  }

  const missingCapitalStock = assessments.filter((a) => a.storedCapacity <= 0).length;
  const stepping = assessments.filter((a) => a.warnings.includes("nameplate-steps-on-headroom"));
  const creditSectors = assessments.filter((a) => a.buildCreditUnits > 0);
  const creditTurns = creditSectors
    .map((a) => a.buildCreditLandsOnTurn)
    .filter((t): t is number => t != null);

  const commodityTotals = new Map<CommodityType, number>();
  for (const a of assessments) {
    for (const [c, d] of Object.entries(a.supplyDeltaUnits)) {
      commodityTotals.set(
        c as CommodityType,
        (commodityTotals.get(c as CommodityType) ?? 0) + (d ?? 0)
      );
    }
  }

  const outstandingSectors = assessments.filter((a) => a.outstandingBuildOrders > 0);

  return {
    verdict: reasons.length === 0 ? "GO" : "NO-GO",
    reasons,
    cautions,
    mode: { current: input.currentMode, alreadyAtPlants },
    turn: input.currentTurn,
    year: input.currentYear,
    governor: input.governor,
    sectors: {
      total: assessments.length,
      willMigrate: assessments.filter((a) => a.willMigrate).length,
      alreadyMigrated: assessments.filter((a) => !a.willMigrate).length,
      missingCapitalStock,
      steppingOnHeadroom: stepping.length,
      mothballed: assessments.filter((a) => a.warnings.includes("mothballed-at-flip")).length,
      withBlockers: withBlockers.length,
      withWarnings: assessments.filter((a) => a.warnings.length > 0).length,
      blockerCounts,
      warningCounts,
    },
    supply: {
      preFlipRevenueAnchor: preFlip,
      postFlipRevenueAnchor: postFlip,
      deltaAnchor,
      deltaPct,
      byCommodity: [...commodityTotals.entries()]
        .map(([commodity, deltaUnits]) => ({ commodity, deltaUnits }))
        .sort((a, b) => Math.abs(b.deltaUnits) - Math.abs(a.deltaUnits)),
    },
    buildCredit: {
      sectors: creditSectors.length,
      units: creditSectors.reduce((s, a) => s + a.buildCreditUnits, 0),
      basisAnchor: creditSectors.reduce((s, a) => s + a.buildCreditBasisAnchor, 0),
      landsBetweenTurns:
        creditTurns.length > 0 ? [Math.min(...creditTurns), Math.max(...creditTurns)] : null,
    },
    cip: {
      sectorsWithOutstanding: outstandingSectors.length,
      outstandingOrders: outstandingSectors.reduce((s, a) => s + a.outstandingBuildOrders, 0),
      totalAnchor: assessments.reduce((s, a) => s + a.computedCipAnchor, 0),
    },
    unowned: input.unowned,
    crises: input.crises,
    worstBlockers: [...withBlockers]
      .sort((a, b) => Math.abs(b.revenueDeltaAnchor) - Math.abs(a.revenueDeltaAnchor))
      .slice(0, 20),
    biggestSteps: [...stepping]
      .sort((a, b) => b.revenueDeltaAnchor - a.revenueDeltaAnchor)
      .slice(0, 20),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Soak watch
// ─────────────────────────────────────────────────────────────────────────────

/** The sector fields the soak watch reads. Money in ₳ (see module header). */
export interface PlantsWatchSectorInput {
  id: string;
  corporationId?: string | null;
  sectorType: CorporationType;
  capitalStock?: number | null;
  producedUnits?: number | null;
  soldUnits?: number | null;
  revenueAnchor: number;
  legacyRevenueShadowAnchor?: number | null;
  plantsStartTurn?: number | null;
  mothballed?: boolean | null;
  buildQueue?: readonly PlantsBuildOrderInput[] | null;
  constructionInProgressAnchor?: number | null;
}

export interface PlantsWatchInput {
  currentTurn: number;
  governorRampTurns: number;
  sectors: readonly PlantsWatchSectorInput[];
  /** Corp liquid capital in ₳, for the cash distribution. */
  corpCashAnchors?: readonly number[];
  /** Live commodity prices, against which drift is measured. */
  commodityPrices?: Partial<Record<CommodityType, number>>;
  basePrices?: Partial<Record<CommodityType, number>>;
}

export interface PlantsWatchSnapshot {
  turn: number;
  capacity: { total: number; mean: number };
  production: {
    producedUnits: number;
    soldUnits: number;
    /** `sold / produced` — how much of what the world made actually cleared. */
    fillRate: number;
    /** `produced / capacity` — how hard the world's plants are running. */
    utilization: number;
    zeroProductionSectors: number;
    zeroProductionPct: number;
    mothballedSectors: number;
  };
  /**
   * THE soak metric. `derivedRevenue` is what plants actually produced;
   * `shadowRevenue` is what capital mode would have produced from the same
   * starting point. The gap is the whole economic effect of the tier.
   */
  drift: {
    derivedRevenueAnchor: number;
    shadowRevenueAnchor: number;
    deltaAnchor: number;
    deltaPct: number;
    sectorsWithShadow: number;
    sectorsWithoutShadow: number;
    severity: "ok" | "warn" | "alarm";
  };
  governor: {
    rampTurns: number;
    /** Sectors whose λ is still < 1 — realized revenue is still being blended. */
    stillGoverned: number;
    /** Sectors that have finished the ramp and run on pure plants economics. */
    ungoverned: number;
    /** Sectors that have not taken their flip turn yet. */
    unmigrated: number;
    meanLambda: number;
    /** The turn the last sector's ramp completes, or null when unknowable. */
    rampCompletesByTurn: number | null;
  };
  build: {
    sectorsWithQueue: number;
    outstandingOrders: number;
    outstandingUnits: number;
    cipAnchor: number;
  };
  corpCash: {
    count: number;
    total: number;
    p10: number;
    median: number;
    p90: number;
    negative: number;
  };
  prices: {
    commodity: CommodityType;
    price: number;
    basePrice: number;
    driftPct: number;
  }[];
  /** Non-empty when something on this snapshot needs an operator's eyes. */
  alerts: string[];
}

/** Nearest-rank percentile over an unsorted array. Returns 0 when empty. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Governor ramp progress for one sector.
 *
 * Mirrors `plantsRampLambda` in `sectorTurn`. Returns null when the sector has
 * not migrated — it has no anchor yet, so it is neither governed nor free.
 */
export function plantsGovernorLambda(
  plantsStartTurn: number | null | undefined,
  currentTurn: number,
  rampTurns: number
): number | null {
  if (plantsStartTurn == null) return null;
  if (!Number.isFinite(rampTurns) || rampTurns <= 0) return 1;
  return Math.max(0, Math.min(1, (currentTurn - plantsStartTurn) / rampTurns));
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Fold a turn's sector documents into the operator's vital signs. */
export function summarizePlantsWatch(input: PlantsWatchInput): PlantsWatchSnapshot {
  const { sectors, currentTurn, governorRampTurns } = input;
  const basePrices = input.basePrices ?? COMMODITY_BASE_PRICES;

  let capacityTotal = 0;
  let produced = 0;
  let sold = 0;
  let zeroProduction = 0;
  let mothballed = 0;
  let derived = 0;
  let shadow = 0;
  let withShadow = 0;
  let withoutShadow = 0;
  let stillGoverned = 0;
  let ungoverned = 0;
  let unmigrated = 0;
  let lambdaSum = 0;
  let lambdaCount = 0;
  let sectorsWithQueue = 0;
  let outstandingOrders = 0;
  let outstandingUnits = 0;
  let cip = 0;
  let latestRampEnd: number | null = null;

  for (const s of sectors) {
    capacityTotal += num(s.capitalStock);
    const p = num(s.producedUnits);
    produced += p;
    sold += num(s.soldUnits);
    if (p <= 0) zeroProduction++;
    if (s.mothballed === true) mothballed++;

    derived += num(s.revenueAnchor);
    // Sectors WITHOUT a shadow are excluded from both sides of the ratio.
    // Adding their live revenue to `derived` while contributing nothing to
    // `shadow` would manufacture drift out of missing data.
    const sh = s.legacyRevenueShadowAnchor;
    if (typeof sh === "number" && Number.isFinite(sh)) {
      shadow += sh;
      withShadow++;
    } else {
      withoutShadow++;
      derived -= num(s.revenueAnchor);
    }

    const lambda = plantsGovernorLambda(s.plantsStartTurn, currentTurn, governorRampTurns);
    if (lambda == null) {
      unmigrated++;
    } else {
      lambdaSum += lambda;
      lambdaCount++;
      if (lambda < 1) {
        stillGoverned++;
        const end = num(s.plantsStartTurn) + governorRampTurns;
        latestRampEnd = latestRampEnd == null ? end : Math.max(latestRampEnd, end);
      } else {
        ungoverned++;
      }
    }

    const queue = (s.buildQueue ?? []).filter(
      (o) => o != null && Number.isFinite(o.unitsOrdered) && o.unitsOrdered > 0
    );
    const outstanding = queue.filter((o) => o.onlineTurn > currentTurn);
    if (outstanding.length > 0) sectorsWithQueue++;
    outstandingOrders += outstanding.length;
    outstandingUnits += outstanding.reduce((sum, o) => sum + o.unitsOrdered, 0);
    cip += num(s.constructionInProgressAnchor);
  }

  const total = sectors.length;
  const zeroProductionPct = total > 0 ? zeroProduction / total : 0;
  const driftDelta = derived - shadow;
  const driftPct = shadow > 0 ? driftDelta / shadow : 0;
  const absDrift = Math.abs(driftPct);
  const severity: "ok" | "warn" | "alarm" =
    absDrift > PLANTS_SHADOW_DRIFT_ALARM_PCT
      ? "alarm"
      : absDrift > PLANTS_SHADOW_DRIFT_WARN_PCT
        ? "warn"
        : "ok";

  const cash = (input.corpCashAnchors ?? []).filter((v) => Number.isFinite(v));

  const prices = Object.entries(input.commodityPrices ?? {})
    .map(([commodity, price]) => {
      const base = basePrices[commodity as CommodityType] ?? 0;
      return {
        commodity: commodity as CommodityType,
        price: num(price),
        basePrice: base,
        driftPct: base > 0 ? (num(price) - base) / base : 0,
      };
    })
    .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));

  const alerts: string[] = [];
  if (severity !== "ok") {
    alerts.push(
      `Derived revenue is ${(driftPct * 100).toFixed(1)}% from the capital-mode shadow (${severity}). ` +
        `Drift is expected and grows on its own; a JUMP between consecutive turns is the failure signature.`
    );
  }
  if (zeroProductionPct > PLANTS_ZERO_PRODUCTION_ALARM_PCT) {
    alerts.push(
      `${zeroProduction}/${total} sectors (${(zeroProductionPct * 100).toFixed(1)}%) produced nothing this turn — ` +
        `above the ${(PLANTS_ZERO_PRODUCTION_ALARM_PCT * 100).toFixed(0)}% alarm line. Check capacity and input gating.`
    );
  } else if (zeroProductionPct > PLANTS_ZERO_PRODUCTION_WARN_PCT) {
    alerts.push(
      `${zeroProduction}/${total} sectors (${(zeroProductionPct * 100).toFixed(1)}%) produced nothing this turn.`
    );
  }
  if (produced > 0 && sold / produced < 0.5) {
    alerts.push(
      `Fill rate ${((sold / produced) * 100 || 0).toFixed(1)}% — over half of what the world produced did not clear. ` +
        `Sustained, this starves corp cash while upkeep keeps billing.`
    );
  }
  if (withoutShadow > 0) {
    alerts.push(
      `${withoutShadow} sector(s) carry no legacyRevenueShadow and are excluded from the drift ratio. ` +
        `They also have NO rollback restore point — see the D13 --verify drill.`
    );
  }

  return {
    turn: currentTurn,
    capacity: { total: capacityTotal, mean: total > 0 ? capacityTotal / total : 0 },
    production: {
      producedUnits: produced,
      soldUnits: sold,
      fillRate: produced > 0 ? sold / produced : 0,
      utilization: capacityTotal > 0 ? produced / capacityTotal : 0,
      zeroProductionSectors: zeroProduction,
      zeroProductionPct,
      mothballedSectors: mothballed,
    },
    drift: {
      derivedRevenueAnchor: derived,
      shadowRevenueAnchor: shadow,
      deltaAnchor: driftDelta,
      deltaPct: driftPct,
      sectorsWithShadow: withShadow,
      sectorsWithoutShadow: withoutShadow,
      severity,
    },
    governor: {
      rampTurns: governorRampTurns,
      stillGoverned,
      ungoverned,
      unmigrated,
      meanLambda: lambdaCount > 0 ? lambdaSum / lambdaCount : 0,
      rampCompletesByTurn: latestRampEnd,
    },
    build: {
      sectorsWithQueue,
      outstandingOrders,
      outstandingUnits,
      cipAnchor: cip,
    },
    corpCash: {
      count: cash.length,
      total: cash.reduce((s, v) => s + v, 0),
      p10: percentile(cash, 0.1),
      median: percentile(cash, 0.5),
      p90: percentile(cash, 0.9),
      negative: cash.filter((v) => v < 0).length,
    },
    prices,
    alerts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build-order flow (needs two snapshots)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build orders placed / landed / cancelled between two turns.
 *
 * There is no build-order event log: the turn `$pull`s landed orders straight
 * out of `buildQueue`, so a landing leaves no trace once it has happened. The
 * only way to count the flow is to diff consecutive snapshots, which is why
 * the watch script persists its own state file.
 *
 * Orders are matched on `(startTurn, onlineTurn, unitsOrdered)` — the queue has
 * no order id. A landing is distinguished from a cancellation by the clock: an
 * order that left the queue with `onlineTurn <= currentTurn` came online; one
 * that left early was cancelled.
 */
export interface PlantsBuildFlow {
  placedOrders: number;
  placedUnits: number;
  landedOrders: number;
  landedUnits: number;
  cancelledOrders: number;
  cancelledUnits: number;
}

function orderKey(o: PlantsBuildOrderInput): string {
  return `${o.startTurn}|${o.onlineTurn}|${o.unitsOrdered}`;
}

export function diffBuildQueues(
  previous: readonly PlantsBuildOrderInput[],
  next: readonly PlantsBuildOrderInput[],
  currentTurn: number
): PlantsBuildFlow {
  const flow: PlantsBuildFlow = {
    placedOrders: 0,
    placedUnits: 0,
    landedOrders: 0,
    landedUnits: 0,
    cancelledOrders: 0,
    cancelledUnits: 0,
  };
  // Multisets: two identical orders on one sector are two orders, not one.
  const nextCounts = new Map<string, number>();
  for (const o of next) nextCounts.set(orderKey(o), (nextCounts.get(orderKey(o)) ?? 0) + 1);

  for (const o of previous) {
    const k = orderKey(o);
    const remaining = nextCounts.get(k) ?? 0;
    if (remaining > 0) {
      nextCounts.set(k, remaining - 1);
      continue;
    }
    if (o.onlineTurn <= currentTurn) {
      flow.landedOrders++;
      flow.landedUnits += o.unitsOrdered;
    } else {
      flow.cancelledOrders++;
      flow.cancelledUnits += o.unitsOrdered;
    }
  }
  for (const [, count] of nextCounts) {
    // Whatever is left unmatched in `next` is new.
    flow.placedOrders += count;
  }
  const prevCounts = new Map<string, number>();
  for (const o of previous) prevCounts.set(orderKey(o), (prevCounts.get(orderKey(o)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const o of next) {
    const k = orderKey(o);
    const used = seen.get(k) ?? 0;
    if (used >= (prevCounts.get(k) ?? 0)) flow.placedUnits += o.unitsOrdered;
    seen.set(k, used + 1);
  }
  return flow;
}

export function mergeBuildFlows(flows: readonly PlantsBuildFlow[]): PlantsBuildFlow {
  return flows.reduce<PlantsBuildFlow>(
    (acc, f) => ({
      placedOrders: acc.placedOrders + f.placedOrders,
      placedUnits: acc.placedUnits + f.placedUnits,
      landedOrders: acc.landedOrders + f.landedOrders,
      landedUnits: acc.landedUnits + f.landedUnits,
      cancelledOrders: acc.cancelledOrders + f.cancelledOrders,
      cancelledUnits: acc.cancelledUnits + f.cancelledUnits,
    }),
    {
      placedOrders: 0,
      placedUnits: 0,
      landedOrders: 0,
      landedUnits: 0,
      cancelledOrders: 0,
      cancelledUnits: 0,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// D13 rollback verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a rollback would COST for one sector, without writing anything.
 *
 * `restoreCapitalModeFromShadow` answers "what would the mutation be". This
 * answers the operator's actual question: "what do I lose". Two populations
 * matter and they are not the same:
 *
 * - **No restore point** (`legacyRevenueShadow` absent or corrupt) — the
 *   rollback CANNOT act. These sectors keep a plants-derived nameplate that
 *   capital mode will then compound forward. This is unrecoverable data loss
 *   in the sense that matters: there is no correct value to write.
 * - **Divergence** — the shadow is present and healthy, but live revenue has
 *   moved away from it, because the sector built (or lost) real capacity while
 *   in plants. Rolling back DISCARDS that. This is expected and fine — it is
 *   what a rollback means — but the operator has to see the magnitude to know
 *   what they are giving up.
 */
export interface PlantsRollbackVerifySectorInput {
  id: string;
  corporationId?: string | null;
  revenueAnchor: number;
  legacyRevenueShadowAnchor?: number | null;
  capitalStock?: number | null;
  plantsStartTurn?: number | null;
}

export interface PlantsRollbackVerifySectorResult {
  id: string;
  corporationId: string | null;
  hasRestorePoint: boolean;
  revenueAnchor: number;
  shadowAnchor: number | null;
  /** `revenue − shadow`. Positive means plants outran the counterfactual. */
  divergenceAnchor: number;
  divergencePct: number;
}

export interface PlantsRollbackVerifyReport {
  lossless: boolean;
  scanned: number;
  withRestorePoint: number;
  withoutRestorePoint: number;
  /** Sectors that never migrated — nothing to restore, nothing lost. */
  neverMigrated: number;
  divergence: {
    sectors: number;
    totalAbsAnchor: number;
    netAnchor: number;
    maxAbsAnchor: number;
    /** Divergent sectors, largest absolute first. */
    worst: PlantsRollbackVerifySectorResult[];
  };
  /** Sectors with no restore point — the population needing a human decision. */
  unrecoverable: PlantsRollbackVerifySectorResult[];
  notes: string[];
}

/** Divergence below this (in ₳) is rounding, not a real loss. */
export const PLANTS_ROLLBACK_DIVERGENCE_EPSILON = 1;

export function verifyPlantsRollback(
  sectors: readonly PlantsRollbackVerifySectorInput[],
  opts: { worstLimit?: number } = {}
): PlantsRollbackVerifyReport {
  const worstLimit = opts.worstLimit ?? 25;
  const results: PlantsRollbackVerifySectorResult[] = [];
  let neverMigrated = 0;

  for (const s of sectors) {
    if (s.plantsStartTurn == null) neverMigrated++;
    const sh = s.legacyRevenueShadowAnchor;
    // Matches the restore script's own definition: a corrupt or negative
    // restore point is not a restore point.
    const hasRestorePoint = typeof sh === "number" && Number.isFinite(sh) && sh >= 0;
    const rev = Number.isFinite(s.revenueAnchor) ? s.revenueAnchor : 0;
    const divergence = hasRestorePoint ? rev - (sh as number) : 0;
    results.push({
      id: s.id,
      corporationId: s.corporationId ?? null,
      hasRestorePoint,
      revenueAnchor: rev,
      shadowAnchor: hasRestorePoint ? (sh as number) : null,
      divergenceAnchor: divergence,
      divergencePct: hasRestorePoint && (sh as number) > 0 ? divergence / (sh as number) : 0,
    });
  }

  const without = results.filter((r) => !r.hasRestorePoint);
  const divergent = results.filter(
    (r) => r.hasRestorePoint && Math.abs(r.divergenceAnchor) > PLANTS_ROLLBACK_DIVERGENCE_EPSILON
  );

  const notes: string[] = [];
  // "Lossless" is a narrow claim and it is deliberately narrow: every sector
  // that took a plants turn has a usable restore point. Divergence does NOT
  // break losslessness — discarding built capacity is what a rollback IS.
  if (without.length === 0) {
    notes.push("Every scanned sector has a finite, non-negative restore point.");
  } else {
    notes.push(
      `${without.length} sector(s) have NO usable restore point. A rollback leaves their revenue at the ` +
        `plants-derived value, which capital mode will then compound forward — a permanent rebase. ` +
        `Decide what each should be BEFORE rolling back.`
    );
    if (neverMigrated > 0) {
      notes.push(
        `${neverMigrated} of the scanned sectors never took a plants turn (plantsStartTurn is null); ` +
          `for those, having no shadow is correct and costs nothing.`
      );
    }
  }
  if (divergent.length > 0) {
    notes.push(
      `${divergent.length} sector(s) have diverged from their shadow. Rolling back DISCARDS that divergence — ` +
        `this is expected (it is the capacity built or lost while in plants) but it is real value changing hands.`
    );
  }

  return {
    lossless: without.length === 0,
    scanned: results.length,
    withRestorePoint: results.length - without.length,
    withoutRestorePoint: without.length,
    neverMigrated,
    divergence: {
      sectors: divergent.length,
      totalAbsAnchor: divergent.reduce((s, r) => s + Math.abs(r.divergenceAnchor), 0),
      netAnchor: divergent.reduce((s, r) => s + r.divergenceAnchor, 0),
      maxAbsAnchor: divergent.reduce((m, r) => Math.max(m, Math.abs(r.divergenceAnchor)), 0),
      worst: [...divergent]
        .sort((a, b) => Math.abs(b.divergenceAnchor) - Math.abs(a.divergenceAnchor))
        .slice(0, worstLimit),
    },
    unrecoverable: without.slice(0, worstLimit),
    notes,
  };
}
