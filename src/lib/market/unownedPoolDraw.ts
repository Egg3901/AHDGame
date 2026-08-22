/**
 * Unowned-pool DRAWDOWN and CREDIT, as one shared pipeline shape.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * The unowned pool is claimable market share. Under plants, market share is
 * `owned / (owned + headroomUnits)`, so a corp that ADDS capacity has to consume
 * headroom or the same demand is counted twice — once as the corp's own output
 * and again as market still up for grabs.
 *
 * `expandSector` got this right at FOUNDING and nothing else did. In particular
 * `buildCapacity` — the only way to grow an existing plant under plants — never
 * touched the pool at all, so every unit built after founding was free of the
 * pool while still counting as owned. Combined with `autoSectorSeed`, which
 * multiplies the pool UP whenever a commodity is distressed, the pool could only
 * trend upward no matter how much capacity the world actually built. Players saw
 * the result as "60% of this market is unowned but the game will not let me
 * expand into it" (ticket #1145), because the expand gate reads a demand gap
 * while the pie reads the pool.
 *
 * The drawdown itself was a 40-line inline pipeline inside `expandSector`, and
 * the module doc on `unownedHeadroom.ts` already records that pool writers have
 * drifted apart twice before. So the shape lives here, once, and both writers
 * call it.
 *
 * ─── Invariants every caller inherits ───────────────────────────────────────
 *
 *  - PLANTS ONLY. Below plants `headroomUnits` is not the leading leg and
 *    nothing reads units, so a unit-denominated draw there would corrupt the
 *    pool. Callers gate on `plantsEnabled` and pass units.
 *  - UPSERT. A (state, type) bucket with no pool doc is legitimate — the
 *    auto-seeder creates them lazily — and without the upsert a drawdown
 *    silently matches nothing and the builder takes the capacity for free.
 *  - SELF-HEALING BASE. A pool doc predating the `headroomUnits` backfill has
 *    `revenue` and no units; `unownedHeadroomBaseExpr` derives units from
 *    revenue rather than defaulting to 0, which would wipe the market.
 *  - CLAMPED AT 0, and the trailing stage RESTATES `revenue` from the
 *    post-write units. Two independently clamped legs diverge permanently the
 *    moment either bottoms out.
 */

import type { CorporationType } from "@/lib/constants/corporations";
import { unownedHeadroomBaseExpr, unownedPoolTrailingSet } from "@/lib/market/unownedHeadroom";

/** Identity of one unowned-pool bucket, plus the scaffolding an upsert needs. */
export interface UnownedPoolBucket {
  stateId: string;
  countryId: string;
  sectorType: CorporationType;
}

/**
 * The aggregation-pipeline stages that move a plants-tier pool bucket by
 * `deltaUnits` — negative to consume headroom, positive to return it.
 *
 * Returned as stages rather than executed so the caller keeps ownership of the
 * write (and of its CAS / idempotency concerns, which differ between founding,
 * building and restoring).
 */
export function unownedPoolDeltaPipeline(
  bucket: UnownedPoolBucket,
  deltaUnits: number,
  now: Date,
  eraUnitScale: number
): object[] {
  const { stateId, countryId, sectorType } = bucket;
  return [
    {
      $set: {
        // Upsert scaffolding: an upserted doc otherwise materialises with only
        // the filter's fields, and a pool row with no countryId is invisible to
        // every country-scoped reader.
        stateId: { $ifNull: ["$stateId", stateId] },
        countryId: { $ifNull: ["$countryId", countryId] },
        sectorType: { $ifNull: ["$sectorType", sectorType] },
        createdAt: { $ifNull: ["$createdAt", now] },
        headroomUnits: {
          $max: [0, { $add: [unownedHeadroomBaseExpr(sectorType, eraUnitScale), deltaUnits] }],
        },
        updatedAt: now,
      },
    },
    // Own stage: it must read the POST-write units, which are only visible to a
    // later stage.
    { $set: unownedPoolTrailingSet(sectorType, true, eraUnitScale) },
  ];
}

/**
 * Consume `units` of headroom because a corp claimed that much of the market.
 * A non-positive or non-finite `units` yields `null`, meaning "no write" — the
 * caller skips the round trip rather than issuing a no-op upsert that would
 * still create an empty bucket.
 */
export function unownedPoolDrawdown(
  bucket: UnownedPoolBucket,
  units: number,
  now: Date,
  eraUnitScale: number
): object[] | null {
  if (!Number.isFinite(units) || units <= 0) return null;
  return unownedPoolDeltaPipeline(bucket, -units, now, eraUnitScale);
}

/**
 * Return `units` of headroom to the market because a claim was undone (a
 * cancelled build's not-yet-delivered remainder).
 */
export function unownedPoolCredit(
  bucket: UnownedPoolBucket,
  units: number,
  now: Date,
  eraUnitScale: number
): object[] | null {
  if (!Number.isFinite(units) || units <= 0) return null;
  return unownedPoolDeltaPipeline(bucket, units, now, eraUnitScale);
}
