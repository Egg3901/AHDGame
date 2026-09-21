import type { CommodityType } from "@/lib/constants/commodities";
import { getProductKind } from "./catalog";
import type { CorporationProduct, ProductDraft, ProductLifecycleStage } from "./types";

export type StartProductResult =
  | { ok: true; product: CorporationProduct }
  | { ok: false; reason: "feature_disabled" | "unknown_product_kind" | "active_product" };

/**
 * Starts the corporation's one permitted active product project.
 *
 * This is the lifecycle seam used by routes, NPP decisions, and tests. It is
 * deliberately pure: persistence supplies the current active product and must
 * enforce the same invariant atomically when the feature gains write routes.
 */
export function startProductDevelopment(args: {
  enabled: boolean;
  activeProduct: CorporationProduct | null;
  draft: ProductDraft;
}): StartProductResult {
  if (!args.enabled) return { ok: false, reason: "feature_disabled" };
  if (args.activeProduct && args.activeProduct.stage !== "retired") {
    return { ok: false, reason: "active_product" };
  }
  if (!getProductKind(args.draft.kindId)) {
    return { ok: false, reason: "unknown_product_kind" };
  }

  return {
    ok: true,
    product: {
      ...args.draft,
      stage: "development",
      developmentSpendAnchor: 0,
      developmentAdvertisingAnchor: 0,
      developmentAdvertisingTurns: 0,
    },
  };
}

// ── Once-per-turn lifecycle processing ───────────────────────────────────────
// Pure rules core: plain data in, next state plus bounded effects out. The turn
// shell (not yet wired) will load the product, call processProductLifecycle,
// persist the returned product, and apply the multipliers and accounting
// deltas itself. This module never touches the market, cash, or the database.

/** Development lasts this many turns after startedTurn before auto-launch. */
export const PRODUCT_DEVELOPMENT_TURNS = 6;
/** Post-launch stage durations, in turns. */
export const PRODUCT_LAUNCH_TURNS = 4;
export const PRODUCT_GROWTH_TURNS = 12;
export const PRODUCT_MATURE_TURNS = 24;
export const PRODUCT_DECLINE_TURNS = 12;
/** Post-launch turns over which capitalized development spend amortizes. */
export const PRODUCT_POST_LAUNCH_TURNS =
  PRODUCT_LAUNCH_TURNS + PRODUCT_GROWTH_TURNS + PRODUCT_MATURE_TURNS + PRODUCT_DECLINE_TURNS;

/**
 * Per-kind lifecycle schedule (issue #2237). Media content kinds override the
 * shared durations above: a daily edition develops in 2 turns while a film
 * needs 10, and catalog tails run longer than live tours. Industrial kinds
 * use the default. Schedules only change WHEN a product advances; the bounded
 * demand/price effects per stage are unchanged.
 */
export interface ProductLifecycleSchedule {
  developmentTurns: number;
  launchTurns: number;
  growthTurns: number;
  matureTurns: number;
  declineTurns: number;
}

export const DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE: ProductLifecycleSchedule = {
  developmentTurns: PRODUCT_DEVELOPMENT_TURNS,
  launchTurns: PRODUCT_LAUNCH_TURNS,
  growthTurns: PRODUCT_GROWTH_TURNS,
  matureTurns: PRODUCT_MATURE_TURNS,
  declineTurns: PRODUCT_DECLINE_TURNS,
};

/** Post-launch turns of one schedule, for the amortization denominator. */
export function postLaunchTurnsForSchedule(schedule: ProductLifecycleSchedule): number {
  return schedule.launchTurns + schedule.growthTurns + schedule.matureTurns + schedule.declineTurns;
}

function sanitizeDuration(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/** Fills non-positive or non-finite schedule fields with the shared defaults. */
export function sanitizeProductLifecycleSchedule(
  schedule: Partial<ProductLifecycleSchedule> | undefined
): ProductLifecycleSchedule {
  if (!schedule) return { ...DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE };
  return {
    developmentTurns: sanitizeDuration(
      schedule.developmentTurns,
      DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE.developmentTurns
    ),
    launchTurns: sanitizeDuration(
      schedule.launchTurns,
      DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE.launchTurns
    ),
    growthTurns: sanitizeDuration(
      schedule.growthTurns,
      DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE.growthTurns
    ),
    matureTurns: sanitizeDuration(
      schedule.matureTurns,
      DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE.matureTurns
    ),
    declineTurns: sanitizeDuration(
      schedule.declineTurns,
      DEFAULT_PRODUCT_LIFECYCLE_SCHEDULE.declineTurns
    ),
  };
}

/** Sector quality used when the corp has no quality-bearing result. */
export const PRODUCT_NEUTRAL_QUALITY = 50;
/** Cap on the launch-quality lift from product-specific R&D (quality points). */
export const PRODUCT_RD_BONUS_CAP = 15;
/** Spend scale for the R&D lift: diminishing sqrt, half the cap at this anchor. */
export const PRODUCT_RD_BONUS_REF = 10000;
/** Launch-quality lift per relevant unlocked technology (quality points). */
export const PRODUCT_TECH_BONUS_EACH = 2;
/** Cap on the total technology lift (quality points). */
export const PRODUCT_TECH_BONUS_CAP = 6;
/** Advertising scale for the brand factor: half effect at this average anchor. */
export const PRODUCT_BRAND_REF = 10000;

/** Hard bounds on the demand multiplier returned to the market shell. */
export const PRODUCT_DEMAND_MIN = 0.8;
export const PRODUCT_DEMAND_MAX = 1.5;
/** Hard bounds on the price-defense multiplier returned to the market shell. */
export const PRODUCT_PRICE_DEFENSE_MIN = 0.9;
export const PRODUCT_PRICE_DEFENSE_MAX = 1.25;
/**
 * Saturation cap for accumulated anchor balances. Anchor inputs beyond this
 * are nonsense magnitudes; capping keeps every downstream value finite no
 * matter what the shell feeds in.
 */
export const PRODUCT_ANCHOR_CAP = 1e15;

/** Per-stage demand base added to 1.0 before quality/brand terms. */
const STAGE_DEMAND_BASE: Record<ProductLifecycleStage, number> = {
  development: 0,
  launch: 0.05,
  growth: 0.15,
  mature: 0.1,
  decline: -0.1,
  retired: 0,
};

/** Per-stage price-defense base added to 1.0 before quality/brand terms. */
const STAGE_PRICE_BASE: Record<ProductLifecycleStage, number> = {
  development: 0,
  launch: 0.02,
  growth: 0.06,
  mature: 0.04,
  decline: -0.04,
  retired: 0,
};

export interface ProcessProductLifecycleArgs {
  enabled: boolean;
  product: CorporationProduct;
  turn: number;
  /** Existing sector quality result (0-100) used as the launch-quality base. */
  sectorQuality: number | null;
  /** This turn's product-specific R&D spend, on the anchor basis. */
  productRnDAnchor?: number;
  /** This turn's effective delivered advertising, on the anchor basis. */
  deliveredAdvertisingAnchor?: number;
  /** Technology ids the corporation has unlocked; only kind-relevant ones count. */
  unlockedTechnologyIds?: readonly string[];
  /**
   * Per-kind lifecycle schedule. Absent reads as the shared industrial
   * default, so every existing caller stays byte-identical.
   */
  schedule?: Partial<ProductLifecycleSchedule>;
}

export interface ProductAccountingDeltas {
  /** R&D capitalized this turn (development only, else 0). */
  developmentSpendDelta: number;
  /** Effective advertising banked this turn (development only, else 0). */
  developmentAdvertisingDelta: number;
  /** Amortized development cost recognized this turn (post-launch only, else 0). */
  amortizationDelta: number;
}

export interface ProcessProductLifecycleResult {
  /** Next product state. Unchanged reference content when nothing advances. */
  product: CorporationProduct;
  /** Bounded demand multiplier for the market shell (1.0 = no effect). */
  demandMultiplier: number;
  /** Bounded price-defense multiplier for the market shell (1.0 = no effect). */
  priceDefenseMultiplier: number;
  /** Catalog output commodity, or null when the kind is unknown. */
  outputCommodity: CommodityType | null;
  accounting: ProductAccountingDeltas;
  /** True when this call advanced state (stamped lastProcessedTurn). */
  advanced: boolean;
  /** True when the turn was already processed (idempotent replay, zero deltas). */
  replayed: boolean;
}

function toNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function zeroAccounting(): ProductAccountingDeltas {
  return { developmentSpendDelta: 0, developmentAdvertisingDelta: 0, amortizationDelta: 0 };
}

/**
 * Launch-quality lift inputs. R&D is product-specific spend accumulated during
 * development; technologies count only when the kind requires them and the
 * corporation unlocked them, so the current catalog (no required techs) yields
 * zero here without inventing node ids.
 */
export function countRelevantUnlockedTech(
  kindId: string,
  unlockedTechnologyIds: readonly string[] | undefined
): number {
  const kind = getProductKind(kindId);
  const required = kind?.requiredTechnologyIds ?? [];
  if (required.length === 0 || !unlockedTechnologyIds || unlockedTechnologyIds.length === 0) {
    return 0;
  }
  const have = new Set(unlockedTechnologyIds);
  let count = 0;
  for (const id of required) {
    if (have.has(id)) count += 1;
  }
  return count;
}

/** Launch quality from the sector base plus one-time R&D and tech lifts. */
export function computeLaunchQuality(args: {
  sectorQuality: number | null;
  developmentSpendAnchor: number;
  relevantTechCount: number;
}): number {
  const base =
    args.sectorQuality != null && Number.isFinite(args.sectorQuality)
      ? clamp(args.sectorQuality, 0, 100)
      : PRODUCT_NEUTRAL_QUALITY;
  const spend = toNonNegative(args.developmentSpendAnchor);
  const rdBonus = PRODUCT_RD_BONUS_CAP * Math.sqrt(spend / (spend + PRODUCT_RD_BONUS_REF));
  const techCount = Number.isFinite(args.relevantTechCount)
    ? Math.max(0, Math.floor(args.relevantTechCount))
    : 0;
  const techBonus = Math.min(PRODUCT_TECH_BONUS_CAP, techCount * PRODUCT_TECH_BONUS_EACH);
  return round1(clamp(base + rdBonus + techBonus, 0, 100));
}

/**
 * productBrand: average effective delivered advertising accumulated during
 * development. Deliberately separate from corporation brandLoyalty, which this
 * module never reads. Turns with no delivered advertising do not dilute the
 * average; zero contributing turns yields zero brand.
 */
export function computeProductBrand(advertisingAnchor: number, contributingTurns: number): number {
  const total = toNonNegative(advertisingAnchor);
  const turns =
    typeof contributingTurns === "number" && Number.isFinite(contributingTurns)
      ? Math.max(0, Math.floor(contributingTurns))
      : 0;
  if (turns <= 0) return 0;
  return round2(total / turns);
}

function stageForTurnsSinceLaunch(
  turnsSinceLaunch: number,
  schedule: ProductLifecycleSchedule
): ProductLifecycleStage {
  let rest = turnsSinceLaunch;
  if (rest < schedule.launchTurns) return "launch";
  rest -= schedule.launchTurns;
  if (rest < schedule.growthTurns) return "growth";
  rest -= schedule.growthTurns;
  if (rest < schedule.matureTurns) return "mature";
  rest -= schedule.matureTurns;
  if (rest < schedule.declineTurns) return "decline";
  return "retired";
}

/**
 * Bounded market effects for a post-launch stage from frozen launch values.
 * Development and retired are always identity (1.0): an unlaunched product
 * has nothing to sell and a retired one is gone from the market.
 */
export function effectsForStage(args: {
  stage: ProductLifecycleStage;
  launchQuality: number | null;
  productBrand: number | undefined;
}): { demandMultiplier: number; priceDefenseMultiplier: number } {
  if (args.stage === "development" || args.stage === "retired") {
    return { demandMultiplier: 1, priceDefenseMultiplier: 1 };
  }
  const quality =
    args.launchQuality != null && Number.isFinite(args.launchQuality)
      ? clamp(args.launchQuality, 0, 100)
      : PRODUCT_NEUTRAL_QUALITY;
  const brand = toNonNegative(args.productBrand);
  const qualityFactor = (quality - PRODUCT_NEUTRAL_QUALITY) / PRODUCT_NEUTRAL_QUALITY;
  const brandFactor = brand / (brand + PRODUCT_BRAND_REF);
  const demand = 1 + STAGE_DEMAND_BASE[args.stage] + 0.1 * qualityFactor + 0.1 * brandFactor;
  const priceDefense = 1 + STAGE_PRICE_BASE[args.stage] + 0.05 * qualityFactor + 0.05 * brandFactor;
  return {
    demandMultiplier: round4(clamp(demand, PRODUCT_DEMAND_MIN, PRODUCT_DEMAND_MAX)),
    priceDefenseMultiplier: round4(
      clamp(priceDefense, PRODUCT_PRICE_DEFENSE_MIN, PRODUCT_PRICE_DEFENSE_MAX)
    ),
  };
}

/**
 * Advances one product exactly one turn. Pure: returns the next state plus the
 * bounded multipliers and accounting deltas the shell applies; nothing here
 * mutates the market or cash.
 *
 * Idempotency: a turn at or before lastProcessedTurn returns the current state
 * unchanged with zero deltas and replayed: true. Flag-off and unknown kinds
 * return identity effects and never stamp or accumulate state.
 */
export function processProductLifecycle(
  args: ProcessProductLifecycleArgs
): ProcessProductLifecycleResult {
  const kind = getProductKind(args.product.kindId);
  const identity = (
    extra?: Partial<ProcessProductLifecycleResult>
  ): ProcessProductLifecycleResult => ({
    product: args.product,
    demandMultiplier: 1,
    priceDefenseMultiplier: 1,
    outputCommodity: kind?.outputCommodity ?? null,
    accounting: zeroAccounting(),
    advanced: false,
    replayed: false,
    ...extra,
  });

  if (!Number.isFinite(args.turn)) return identity();
  if (!kind) return identity();
  if (!args.enabled) return identity();
  if (args.product.stage === "retired") return identity();

  const last = args.product.lastProcessedTurn;
  if (last != null && Number.isFinite(last) && args.turn <= last) {
    const effects = effectsForStage({
      stage: args.product.stage,
      launchQuality: args.product.launchQuality ?? null,
      productBrand: args.product.productBrand,
    });
    return identity({
      demandMultiplier: effects.demandMultiplier,
      priceDefenseMultiplier: effects.priceDefenseMultiplier,
      replayed: true,
    });
  }

  const rnd = toNonNegative(args.productRnDAnchor);
  const ads = toNonNegative(args.deliveredAdvertisingAnchor);
  const next: CorporationProduct = { ...args.product };
  const accounting = zeroAccounting();
  const schedule = sanitizeProductLifecycleSchedule(args.schedule);
  const postLaunchTurns = postLaunchTurnsForSchedule(schedule);

  if (next.stage === "development") {
    if (rnd > 0) {
      const room = Math.max(0, PRODUCT_ANCHOR_CAP - next.developmentSpendAnchor);
      const accepted = Math.min(rnd, room);
      next.developmentSpendAnchor = round2(next.developmentSpendAnchor + accepted);
      accounting.developmentSpendDelta = round2(accepted);
    }
    if (ads > 0) {
      const room = Math.max(0, PRODUCT_ANCHOR_CAP - next.developmentAdvertisingAnchor);
      const accepted = Math.min(ads, room);
      next.developmentAdvertisingAnchor = round2(next.developmentAdvertisingAnchor + accepted);
      next.developmentAdvertisingTurns += 1;
      accounting.developmentAdvertisingDelta = round2(accepted);
    }
    if (args.turn >= next.startedTurn + schedule.developmentTurns) {
      next.launchQuality = computeLaunchQuality({
        sectorQuality: args.sectorQuality,
        developmentSpendAnchor: next.developmentSpendAnchor,
        relevantTechCount: countRelevantUnlockedTech(next.kindId, args.unlockedTechnologyIds),
      });
      // Frozen exactly once at launch; later turns never recompute it.
      next.productBrand = computeProductBrand(
        next.developmentAdvertisingAnchor,
        next.developmentAdvertisingTurns
      );
      next.launchedTurn = args.turn;
      next.stage = "launch";
      // The launch turn is post-launch: it carries its amortization share so
      // the full capitalized spend is recognized over the schedule's
      // post-launch turns.
      if (postLaunchTurns > 0 && next.developmentSpendAnchor > 0) {
        accounting.amortizationDelta = next.developmentSpendAnchor / postLaunchTurns;
      }
    }
  } else {
    const launchedTurn =
      next.launchedTurn != null && Number.isFinite(next.launchedTurn)
        ? next.launchedTurn
        : args.turn;
    const stage = stageForTurnsSinceLaunch(Math.max(0, args.turn - launchedTurn), schedule);
    if (stage === "retired") {
      next.stage = "retired";
      next.retiredTurn = args.turn;
    } else {
      next.stage = stage;
      if (postLaunchTurns > 0 && next.developmentSpendAnchor > 0) {
        accounting.amortizationDelta = next.developmentSpendAnchor / postLaunchTurns;
      }
    }
  }

  next.lastProcessedTurn = args.turn;
  const effects = effectsForStage({
    stage: next.stage,
    launchQuality: next.launchQuality ?? null,
    productBrand: next.productBrand,
  });
  return {
    product: next,
    demandMultiplier: effects.demandMultiplier,
    priceDefenseMultiplier: effects.priceDefenseMultiplier,
    outputCommodity: kind.outputCommodity,
    accounting,
    advanced: true,
    replayed: false,
  };
}
