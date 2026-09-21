import type { CommodityType } from "@/lib/constants/commodities";
import { getProductKind } from "./catalog";
import { PRODUCT_BRAND_REF, PRODUCT_NEUTRAL_QUALITY, effectsForStage } from "./lifecycle";
import type { CorporationProduct, ProductLifecycleStage } from "./types";

/**
 * Post-launch product market effects (issues #2236/#2238).
 *
 * Pure rules: turns persisted post-launch products into bounded adjustments
 * for the clearing inputs the corporation turn already builds. A product in
 * development has nothing to sell and a retired one is gone from the market,
 * so both resolve to no effect here exactly as in the lifecycle core.
 *
 * The adjustments ride the existing quality-aware seams and create nothing:
 * launch quality replaces the corp average for sectors selling the product's
 * output commodity (price defense through the quality-to-premium coupling),
 * and a brand-derived bonus adds to corp loyalty for those sectors (demand
 * through the loyal-slice pre-pass). Output, inventory, capacity, inputs,
 * and cash are untouched; only the fill and premium of actually produced
 * output move, inside the lifecycle's published bounds.
 */

/** Lifecycle stages that sell output. */
export const POST_LAUNCH_PRODUCT_STAGES: readonly ProductLifecycleStage[] = [
  "launch",
  "growth",
  "mature",
  "decline",
];

export interface ProductClearingEffect {
  corporationId: string;
  productId: string;
  kindId: string;
  outputCommodity: CommodityType;
  /** Frozen launch quality (0-100) for the premium seam. */
  launchQuality: number;
  /** Brand-derived loyalty bonus (0-100) for the loyal-slice seam. */
  loyaltyBonus: number;
  /** Bounded lifecycle demand multiplier (telemetry/display). */
  demandMultiplier: number;
  /** Bounded lifecycle price-defense multiplier (telemetry/display). */
  priceDefenseMultiplier: number;
  stage: ProductLifecycleStage;
}

function clampScore(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, value));
}

/** Brand (anchor average, unbounded) mapped to loyalty points (0-100). */
export function productLoyaltyBonus(productBrand: unknown): number {
  if (typeof productBrand !== "number" || !Number.isFinite(productBrand) || productBrand <= 0) {
    return 0;
  }
  return Math.round(100 * (productBrand / (productBrand + PRODUCT_BRAND_REF)) * 10) / 10;
}

/**
 * Resolves one clearing effect per corporation from persisted products.
 * Flag-off returns an empty map; unknown kinds and non-post-launch stages
 * resolve to no effect. First product per corporation wins, matching the
 * one-active-product slot invariant.
 */
export function resolveProductClearingEffects(
  products: readonly CorporationProduct[],
  enabled: boolean
): Map<string, ProductClearingEffect> {
  const effects = new Map<string, ProductClearingEffect>();
  if (enabled !== true || !Array.isArray(products)) return effects;
  for (const product of products) {
    if (!product || typeof product.corporationId !== "string") continue;
    if (effects.has(product.corporationId)) continue;
    if (!POST_LAUNCH_PRODUCT_STAGES.includes(product.stage)) continue;
    const kind = getProductKind(product.kindId);
    if (!kind) continue;
    const launchQuality = clampScore(product.launchQuality, PRODUCT_NEUTRAL_QUALITY);
    const brand =
      typeof product.productBrand === "number" && Number.isFinite(product.productBrand)
        ? Math.max(0, product.productBrand)
        : 0;
    const market = effectsForStage({
      stage: product.stage,
      launchQuality,
      productBrand: brand,
    });
    effects.set(product.corporationId, {
      corporationId: product.corporationId,
      productId: product.id,
      kindId: product.kindId,
      outputCommodity: kind.outputCommodity,
      launchQuality,
      loyaltyBonus: productLoyaltyBonus(brand),
      demandMultiplier: market.demandMultiplier,
      priceDefenseMultiplier: market.priceDefenseMultiplier,
      stage: product.stage,
    });
  }
  return effects;
}

export interface ApplyProductClearingEffectInput {
  effect?: ProductClearingEffect | null;
  /** The sector's effective supply mix; the effect applies only when it sells the output. */
  supplyRates?: Partial<Record<CommodityType, number>> | null;
  brandLoyalty?: number | null;
  outputQuality?: number | null;
  loyaltyEnabled: boolean;
  qualityEnabled: boolean;
}

export interface AdjustedClearingQuality {
  brandLoyalty?: number | null;
  outputQuality?: number | null;
}

/**
 * Applies one product effect to a sector's clearing quality inputs. Returns
 * the inputs unchanged when there is no effect, the sector does not sell the
 * product's output commodity, or the corresponding seam flag is off, so
 * flag-off and unrelated sectors stay byte-identical.
 */
export function applyProductClearingEffect(
  input: ApplyProductClearingEffectInput
): AdjustedClearingQuality {
  const base = { brandLoyalty: input.brandLoyalty, outputQuality: input.outputQuality };
  const effect = input.effect;
  if (!effect) return base;
  const rate = input.supplyRates?.[effect.outputCommodity] ?? 0;
  if (!(typeof rate === "number" && rate > 0)) return base;
  const adjusted = { ...base };
  if (input.qualityEnabled === true) {
    adjusted.outputQuality = effect.launchQuality;
  }
  if (input.loyaltyEnabled === true) {
    const corpLoyalty =
      typeof input.brandLoyalty === "number" && Number.isFinite(input.brandLoyalty)
        ? input.brandLoyalty
        : 0;
    adjusted.brandLoyalty =
      Math.round(Math.min(100, Math.max(0, corpLoyalty + effect.loyaltyBonus)) * 10) / 10;
  }
  return adjusted;
}
