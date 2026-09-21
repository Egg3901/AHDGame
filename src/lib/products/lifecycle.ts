import { getProductKind } from "./catalog";
import type { CorporationProduct, ProductDraft } from "./types";

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
