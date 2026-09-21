import { PRODUCT_KINDS } from "./catalog";
import type { ProductFamily, ProductKindDefinition } from "./types";

export interface ProductCatalogQuery {
  family: ProductFamily;
  /**
   * The corporation's selected operating models. Applies to media products
   * only; industrial products ignore it. Absent means no model filtering.
   */
  operatingModels?: readonly string[];
  /**
   * Technology ids the corporation has unlocked. Kinds without requirements
   * always pass; kinds with requirements need every required id present.
   * Absent disables technology filtering. No technology nodes exist yet, so
   * this is currently a representable seam, not an active gate.
   */
  unlockedTechnologyIds?: readonly string[];
}

/**
 * Read-only product catalog query for corporation routes. Returns the product
 * kinds legal for the requested family, narrowed to the corporation's
 * operating models for media products. Pure: no persistence, no turn reads.
 */
export function queryProductCatalog(query: ProductCatalogQuery): ProductKindDefinition[] {
  const selectedModels = query.operatingModels ? new Set(query.operatingModels) : null;
  const unlockedTech = query.unlockedTechnologyIds ? new Set(query.unlockedTechnologyIds) : null;
  return PRODUCT_KINDS.filter((catalogKind) => {
    const kind: ProductKindDefinition = catalogKind;
    if (kind.family !== query.family) return false;
    if (
      kind.family === "media_entertainment" &&
      selectedModels !== null &&
      (kind.operatingModels?.length ?? 0) > 0 &&
      !kind.operatingModels.some((model) => selectedModels.has(model))
    ) {
      return false;
    }
    const required = kind.requiredTechnologyIds ?? [];
    if (unlockedTech !== null && !required.every((id) => unlockedTech.has(id))) return false;
    return true;
  });
}
