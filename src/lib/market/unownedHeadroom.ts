/**
 * Unowned-sector headroom units — pure conversion helper.
 *
 * P1 of the "buildable sectors" plan (see ops-knowledge design doc). Unowned
 * sectors currently hold one economic field, `revenue` (₳-native — see the
 * doc comment on UnownedSector). A later phase reinterprets unowned sectors
 * as demand-side "market headroom" measured in commodity units instead of ₳
 * revenue. This module computes that derived value; nothing reads it yet.
 *
 * Conversion mirrors `impliedOutputUnits` in src/lib/market/capital.ts (the
 * corp-side revenue -> capacity-units formula) so the unit basis matches
 * corp-side units exactly:
 *
 *     units = Σ_c revenue × supplyRate_c / basePrice_c
 *
 * using the sector type's DEFAULT strategy ("standard", via getStrategy —
 * the same fallback every other call site in the codebase uses for
 * `sector.strategyId ?? "standard"`) since unowned sectors carry no
 * strategyId of their own.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { getStrategy } from "@/lib/constants/sectorStrategies";
import { impliedOutputUnits } from "@/lib/market/capital";

/** Strategy id used to resolve an unowned sector's commodity mix (no strategyId field exists on UnownedSector). */
export const UNOWNED_HEADROOM_DEFAULT_STRATEGY_ID = "standard";

/**
 * Convert an unowned sector's ₳ revenue into implied units-of-unmet-demand,
 * using its sector type's default-strategy supply mix. Returns 0 for
 * non-positive/non-finite revenue (matches impliedOutputUnits).
 */
export function computeUnownedHeadroomUnits(
  sectorType: CorporationType,
  revenue: number,
  unitScale: number
): number {
  return computeSectorImpliedUnits(
    sectorType,
    revenue,
    UNOWNED_HEADROOM_DEFAULT_STRATEGY_ID,
    unitScale
  );
}

/**
 * Revenue -> implied units on a SPECIFIC strategy's supply mix.
 *
 * Same formula as {@link computeUnownedHeadroomUnits}, but honouring the
 * sector's own `strategyId` instead of forcing "standard". Owned sectors have
 * one; feeding them through the default mix is only correct for sectors that
 * happen to run it.
 *
 * `getStrategy` already falls back to the type's first (standard) strategy for
 * an unknown/absent id, so passing undefined reproduces the default behaviour.
 */
export function computeSectorImpliedUnits(
  sectorType: CorporationType,
  revenue: number,
  strategyId: string | null | undefined,
  unitScale: number
): number {
  const strategy = getStrategy(sectorType, strategyId ?? UNOWNED_HEADROOM_DEFAULT_STRATEGY_ID);
  return impliedOutputUnits(revenue, strategy.supply, COMMODITY_BASE_PRICES, unitScale);
}

/**
 * Units implied by ONE unit of ₳ revenue on the default mix.
 *
 * `impliedOutputUnits` is strictly linear in revenue (Σ revenue x rate / base),
 * so headroom for any positive revenue is `revenue x this`. That lets the
 * derived `headroomUnits` field be maintained inside a Mongo update pipeline
 * (where the JS helper cannot run) without drifting from the helper.
 */
export function unownedHeadroomUnitsPerAnchor(
  sectorType: CorporationType,
  unitScale: number
): number {
  return computeUnownedHeadroomUnits(sectorType, 1, unitScale);
}

/**
 * The SELF-HEALING base expression for `unownedSectors.headroomUnits` inside a
 * Mongo aggregation-pipeline update.
 *
 * `headroomUnits` was added after the field-less docs already existed, so a
 * pool row can legitimately carry `revenue` and no `headroomUnits` at all. Every
 * pipeline that reads the pool must therefore heal that row by deriving the
 * units from `revenue` rather than falling back to a bare `0` — a `0` fallback
 * turns a drawdown (`$max: [0, base - draw]`) into a TOTAL WIPE of the market's
 * headroom while `revenue` is only decremented by the drawn amount, which both
 * destroys the pool and leaves the two views permanently divergent.
 *
 * Five call sites need this expression (restore, shed, both attack routes, the
 * auto-seed boost, founding and the NPP drawdown). It lives here, once, because
 * two of them had already drifted to the `0` fallback independently.
 */
export function unownedHeadroomBaseExpr(sectorType: CorporationType, unitScale: number): object {
  return {
    $ifNull: [
      "$headroomUnits",
      {
        $multiply: [
          { $ifNull: ["$revenue", 0] },
          unownedHeadroomUnitsPerAnchor(sectorType, unitScale),
        ],
      },
    ],
  };
}

/**
 * Which of a pool row's two legs is AUTHORITATIVE for the current market tier.
 *
 * `revenue` and `headroomUnits` describe one market in two units. Exactly one of
 * them LEADS: a write applies its delta to the leading leg and then RESTATES the
 * other from it (see {@link unownedPoolTrailingSet}). Under plants the units
 * lead, because units are what market share divides by and what founding builds
 * draw down; below plants ₳ revenue leads, because nothing reads units yet.
 *
 * Getting this backwards is silent and permanent. Drawdowns clamp the leading
 * leg at 0 and do NOT push that clamp back through the other leg
 * proportionally, so a writer that leads with `revenue` under plants restates
 * `headroomUnits` from a revenue figure that still carries demand the pool
 * already spent — RESURRECTING headroom that expansions consumed. It is exported
 * as a named concept so a call site has to state which tier it is in rather than
 * pick a field and hope.
 */
export function unownedPoolLeadingField(plantsEnabled: boolean): "headroomUnits" | "revenue" {
  return plantsEnabled ? "headroomUnits" : "revenue";
}

/**
 * The self-healing base to apply a delta ONTO, for whichever leg leads.
 *
 * Under plants this is {@link unownedHeadroomBaseExpr} (units, healing a row
 * that predates the `headroomUnits` backfill from its revenue). Below plants it
 * is the row's own revenue with a `0` default, which is safe there because
 * `revenue` is the field that has always existed.
 */
export function unownedPoolCreditBaseExpr(
  sectorType: CorporationType,
  plantsEnabled: boolean,
  unitScale: number
) {
  return plantsEnabled
    ? unownedHeadroomBaseExpr(sectorType, unitScale)
    : { $ifNull: ["$revenue", 0] as const };
}

/**
 * The FINAL pipeline `$set` stage that restates the TRAILING leg from the
 * leading one, after the leading leg has been written.
 *
 * Must run as its own stage: it reads the POST-write value of the leading field,
 * which is only visible to a later stage. Every pool writer ends with this, so
 * the two legs cannot drift no matter what the delta was:
 *
 *   - under plants  → `revenue = headroomUnits / unitsPerAnchor`
 *   - below plants  → `headroomUnits = revenue x unitsPerAnchor`
 *
 * `ownershipTransition.releaseSectorToUnowned` was the one writer that ran the
 * BELOW-plants restatement unconditionally, so under plants it both led with the
 * wrong leg and re-derived units from a stale revenue. Extracted here so a
 * writer cannot pick the wrong direction for its tier.
 */
export function unownedPoolTrailingSet(
  sectorType: CorporationType,
  plantsEnabled: boolean,
  unitScale: number
): object {
  const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(sectorType, unitScale);
  if (plantsEnabled) {
    const anchorPerUnit = unitsPerAnchor > 0 ? 1 / unitsPerAnchor : 0;
    return { revenue: { $multiply: ["$headroomUnits", anchorPerUnit] } };
  }
  return { headroomUnits: { $multiply: ["$revenue", unitsPerAnchor] } };
}

/**
 * The `$set` stage for a PROPORTIONAL BOOST of one unowned-pool row — the shape
 * used by both the per-turn auto-seeder and the admin `seed-unowned` route.
 *
 * The two legs of a pool row (`revenue`, `headroomUnits`) describe the same
 * market in different units and must never be scaled independently. Which one
 * LEADS depends on the market tier, and that is the whole reason this is shared:
 *
 *  - BELOW plants `revenue` leads and `headroomUnits` is re-derived from the
 *    post-boost figure, which also heals a row that never had the field.
 *  - UNDER plants `headroomUnits` IS the pool — it is what market share divides
 *    by and what founding builds draw down — so the boost applies to the UNITS
 *    and revenue is reconstructed from them. Re-deriving units from a boosted
 *    revenue instead would RESURRECT headroom that expansions had already
 *    consumed, because every drawdown clamps at 0 and is not reflected back into
 *    revenue proportionally.
 *
 * The admin route ran the below-plants pipeline unconditionally, so under plants
 * its boost moved `revenue` and left the unit view stale: the relief never
 * reached the pool players actually draw from, and the two legs diverged
 * permanently. Extracted here so a third caller cannot reintroduce that.
 */
export function unownedPoolBoostSet(
  sectorType: CorporationType,
  multiplier: number,
  now: Date,
  plantsEnabled: boolean,
  unitScale: number
): object {
  const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(sectorType, unitScale);
  const boostedUnits = { $multiply: [unownedHeadroomBaseExpr(sectorType, unitScale), multiplier] };
  if (plantsEnabled) {
    return {
      headroomUnits: boostedUnits,
      revenue:
        unitsPerAnchor > 0
          ? { $round: [{ $divide: [boostedUnits, unitsPerAnchor] }, 0] }
          : "$revenue",
      updatedAt: now,
    };
  }
  const boostedRevenue = { $round: [{ $multiply: ["$revenue", multiplier] }, 0] };
  return {
    revenue: boostedRevenue,
    headroomUnits: { $multiply: [boostedRevenue, unitsPerAnchor] },
    updatedAt: now,
  };
}
