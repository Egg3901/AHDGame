import { STRANDED_DIVEST_TURNS } from "@/lib/corporations/strandedPlant";
import type { CorporationType } from "@/lib/constants/corporations";
import type { NppAutonomyLevel } from "@/lib/db/types/gameState";
import { nppAutonomyLevelAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { getProductKind } from "@/lib/products/catalog";
import { queryProductCatalog } from "@/lib/products/queries";
import {
  MEDIA_OPERATING_MODELS,
  type CorporationProduct,
  type MediaOperatingModel,
} from "@/lib/products/types";
import { NPP_GROWTH_DEPLOY_FRACTION } from "./nppCorporationTuning";

/**
 * Pure NPP corporation product decision (issues #2236/#2237/#2238).
 *
 * Rules core for the product slice of the NPP brain: given the corporation's
 * type, owned operating models, unlocked technologies, cash position, current
 * strategy permission, and current active product, recommend at most one
 * product action for the turn orchestration layer to execute later through
 * the product persistence commands (`startProductPersistent`,
 * `addOperatingModelPersistent`, `retireProductPersistent`).
 *
 * This module never touches persistence itself and never bypasses it: every
 * recommendation the executor carries out still passes through the commands
 * that enforce the one-active-product slot, so a stale `start_product` intent
 * against a corporation that gained a product since deciding maps to
 * `active_product` instead of a second active product.
 *
 * Deterministic: identical inputs always produce the identical action. No
 * clock, no randomness, no environment reads; the turn number is not even an
 * input because no rule here depends on it.
 *
 * Conservative initial policy. Starting or acquiring requires the same
 * surplus bar the caller demands for sector expansion (its own
 * `EXPANSION_MIN_CASH`-derived floor, passed in as `minStartSurplusLocal`),
 * the strategy loop's own expansion permission, and a product-eligible
 * corporation type. Spend is bounded by the growth deploy fraction: a new
 * product is a growth bet, so it may claim at most the same share of
 * post-floor surplus a plant growth build may
 * (`NPP_GROWTH_DEPLOY_FRACTION`). Retirement needs explicit sustained-failure
 * evidence; anything missing reads as healthy and the product continues.
 */
export type NppProductNeutralReason =
  | "feature_disabled"
  | "unknown_level"
  | "below_v4"
  | "non_finite_cash"
  | "below_cash_floor"
  | "expansion_blocked_by_strategy"
  | "insufficient_surplus"
  | "ineligible_corporation_type"
  | "no_legal_product";

export type NppProductAction =
  | { kind: "none"; reason: NppProductNeutralReason }
  | {
      kind: "acquire_operating_model";
      operatingModel: MediaOperatingModel;
      /** Upper bound the executor may spend, in corporation-local currency. */
      maxSpendLocal: number;
    }
  | {
      kind: "start_product";
      kindId: string;
      name: string;
      /** Upper bound the executor may spend, in corporation-local currency. */
      maxSpendLocal: number;
    }
  | { kind: "continue_product"; productId: string }
  | { kind: "retire_product"; productId: string; failingTurns: number };

export interface NppProductDecisionInput {
  /** `corporationProductsEnabled` gameConfig gate. False (or unset) is fully neutral. */
  enabled: boolean;
  /** Effective autonomy level. Below V4 (or absent) is fully neutral. */
  autonomyLevel?: NppAutonomyLevel;
  corporationId: string;
  corporationType: CorporationType;
  /** Owned media operating models. Absent reads as none. Unknown names are ignored. */
  operatingModels?: readonly string[];
  /** Unlocked technology ids. Absent disables technology filtering. */
  unlockedTechnologyIds?: readonly string[];
  /** Current non-retired product, when the caller has loaded it. */
  activeProduct?: CorporationProduct | null;
  /**
   * Sustained-failure evidence for the active product, in turns. Absent (or
   * non-finite) reads as healthy: the product continues and is never retired.
   */
  failingTurns?: number;
  /** Corporation-local liquid capital and cash floor, as the brain computed them. */
  cashLocal?: number;
  cashFloorLocal?: number;
  /**
   * Surplus bar a new commitment must clear, in corporation-local currency.
   * The caller passes its own expansion minimum so products never undercut
   * the sector-expansion affordability rail.
   */
  minStartSurplusLocal?: number;
  /** The strategy loop's expansion permission (`levers.allowExpansion`). */
  expansionAllowed?: boolean;
}

/** Corporation types that may run Media & Entertainment products. */
const MEDIA_CORP_TYPES: ReadonlySet<CorporationType> = new Set(["media", "entertainment"]);

/** Corporation types that may run industrial-manufacturing products. */
const INDUSTRIAL_CORP_TYPES: ReadonlySet<CorporationType> = new Set([
  "manufacturing",
  "automobiles",
]);

const KNOWN_MODELS: ReadonlySet<string> = new Set(MEDIA_OPERATING_MODELS);

/** Turns of documented failure before a chronic product failure may be retired. */
export const NPP_PRODUCT_RETIRE_FAILING_TURNS = STRANDED_DIVEST_TURNS;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Normalize a string list for deterministic matching: dedupe, drop empties, sort. */
function normalizeList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.filter((v) => typeof v === "string" && v.length > 0))].sort();
}

function spendBound(surplusLocal: number): number {
  return Math.floor(surplusLocal * NPP_GROWTH_DEPLOY_FRACTION);
}

export function decideNppProduct(input: NppProductDecisionInput): NppProductAction {
  if (input.enabled !== true) {
    return { kind: "none", reason: "feature_disabled" };
  }
  if (input.autonomyLevel === undefined) {
    return { kind: "none", reason: "unknown_level" };
  }
  if (!nppAutonomyLevelAtLeast(input.autonomyLevel, "v4")) {
    return { kind: "none", reason: "below_v4" };
  }

  const active = input.activeProduct ?? null;
  if (active && active.stage !== "retired") {
    const failing = input.failingTurns;
    if (isFiniteNumber(failing) && failing >= NPP_PRODUCT_RETIRE_FAILING_TURNS) {
      return { kind: "retire_product", productId: active.id, failingTurns: failing };
    }
    return { kind: "continue_product", productId: active.id };
  }

  if (
    !isFiniteNumber(input.cashLocal) ||
    !isFiniteNumber(input.cashFloorLocal) ||
    !isFiniteNumber(input.minStartSurplusLocal)
  ) {
    return { kind: "none", reason: "non_finite_cash" };
  }
  const surplusLocal = input.cashLocal - input.cashFloorLocal;
  if (!(surplusLocal > 0)) {
    return { kind: "none", reason: "below_cash_floor" };
  }
  if (input.expansionAllowed !== true) {
    return { kind: "none", reason: "expansion_blocked_by_strategy" };
  }
  if (surplusLocal < input.minStartSurplusLocal) {
    return { kind: "none", reason: "insufficient_surplus" };
  }

  const techFilter =
    input.unlockedTechnologyIds === undefined
      ? undefined
      : normalizeList(input.unlockedTechnologyIds);
  const maxSpendLocal = spendBound(surplusLocal);

  if (MEDIA_CORP_TYPES.has(input.corporationType)) {
    const owned = normalizeList(input.operatingModels).filter((m) => KNOWN_MODELS.has(m));
    if (owned.length === 0) {
      for (const model of MEDIA_OPERATING_MODELS) {
        const kinds = queryProductCatalog({
          family: "media_entertainment",
          operatingModels: [model],
          unlockedTechnologyIds: techFilter,
        });
        if (kinds.length > 0) {
          return { kind: "acquire_operating_model", operatingModel: model, maxSpendLocal };
        }
      }
      return { kind: "none", reason: "no_legal_product" };
    }
    const kinds = queryProductCatalog({
      family: "media_entertainment",
      operatingModels: owned,
      unlockedTechnologyIds: techFilter,
    });
    if (kinds.length === 0) {
      return { kind: "none", reason: "no_legal_product" };
    }
    const kind = kinds[0];
    return { kind: "start_product", kindId: kind.id, name: kind.label, maxSpendLocal };
  }

  if (INDUSTRIAL_CORP_TYPES.has(input.corporationType)) {
    const kinds = queryProductCatalog({
      family: "industrial_manufacturing",
      unlockedTechnologyIds: techFilter,
    });
    if (kinds.length === 0) {
      return { kind: "none", reason: "no_legal_product" };
    }
    const kind = kinds[0];
    return { kind: "start_product", kindId: kind.id, name: kind.label, maxSpendLocal };
  }

  return { kind: "none", reason: "ineligible_corporation_type" };
}

/** Re-export for callers that want to validate a recommended kind without importing the catalog. */
export { getProductKind };
