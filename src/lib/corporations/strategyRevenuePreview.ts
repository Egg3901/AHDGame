import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";

export interface StrategyRevenueProjectionInput {
  /** Sector revenue in ₳ (anchor) per turn — the base the supply rates scale. */
  revenueAnchor: number;
  /** Candidate strategy's supply rates (commodity → rate). */
  supply: Partial<Record<CommodityType, number>>;
  /**
   * Lagged price ratio per commodity: globalPrice / basePrice. Missing or
   * non-positive entries read as 1 (at base) — matches the price-realization
   * ratio map in sectorDetail.
   */
  priceRatioByCommodity: ReadonlyMap<string, number>;
  /**
   * Extraction only — per-resource capacity multipliers (0–1) for this sector
   * under the candidate strategy. `undefined` = uncapped state (no cap doc);
   * `null` = cap doc exists but carries no resources (zero capacity for all
   * extractables). Non-extraction callers omit it.
   */
  capacityMultipliers?: Partial<Record<ExtractableResource, number>> | null;
}

/**
 * Projected ₳/turn a strategy would gross at current lagged prices:
 *   revenue × Σ_over_outputs(rate × priceRatio × capacityMultiplier-if-extractable)
 *
 * Read-only preview for the strategy picker — it deliberately ignores margin
 * modifiers, transitions and demand-side costs; it exists to make "you are
 * strategized into a resource this state barely has" visible before retooling.
 */
export function projectStrategyRevenuePerTurn(input: StrategyRevenueProjectionInput): number {
  const { revenueAnchor, supply, priceRatioByCommodity, capacityMultipliers } = input;
  if (!(revenueAnchor > 0)) return 0;

  let factor = 0;
  for (const [commodity, rate] of Object.entries(supply)) {
    if (typeof rate !== "number" || rate <= 0) continue;
    const rawRatio = priceRatioByCommodity.get(commodity);
    const ratio = typeof rawRatio === "number" && rawRatio > 0 ? rawRatio : 1;
    let capMult = 1;
    if (
      capacityMultipliers !== undefined &&
      (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity)
    ) {
      capMult =
        capacityMultipliers === null
          ? 0
          : (capacityMultipliers[commodity as ExtractableResource] ?? 1);
    }
    factor += rate * ratio * capMult;
  }
  return revenueAnchor * factor;
}

export interface DepositCapacityRow {
  resource: ExtractableResource;
  /** State capacity in units/turn for this resource. */
  capacity: number;
  /** Total desired (unconstrained revenue-based) output across the state's extraction sectors. */
  desired: number;
  /** capacity − desired; negative when the deposit is oversubscribed. */
  headroom: number;
}

/**
 * Per-state deposit view for extraction sectors: for each resource with
 * capacity in the state, how much is wanted vs. how much room is left.
 */
export function buildDepositCapacityRows(
  stateResources: Partial<Record<ExtractableResource, number>>,
  desiredByResource: Partial<Record<ExtractableResource, number>>
): DepositCapacityRow[] {
  const rows: DepositCapacityRow[] = [];
  for (const resource of EXTRACTABLE_RESOURCES) {
    const capacity = stateResources[resource] ?? 0;
    if (capacity <= 0) continue;
    const desired = desiredByResource[resource] ?? 0;
    rows.push({
      resource,
      capacity: Math.round(capacity * 100) / 100,
      desired: Math.round(desired * 100) / 100,
      headroom: Math.round((capacity - desired) * 100) / 100,
    });
  }
  return rows;
}
