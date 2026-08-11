import type { Db } from "mongodb";
import type { CorporateSector, StateMetrics, UnownedSector } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import {
  bucketKey,
  computeStateControlledBuckets,
  loadNationalCorpIds,
} from "@/lib/nationalization/stateControlledBuckets";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { unownedHeadroomUnitsPerAnchor } from "@/lib/market/unownedHeadroom";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

const FALLBACK_GROWTH_RATE = 1; // % per game year (same unit as corporate growthRate)

/**
 * Fallback annual demand growth (%) for a state with no `gdpGrowth` metric —
 * an unmetered state, a legacy document, or a test fixture. Matches
 * {@link FALLBACK_GROWTH_RATE} so an unmetered plants world grows its headroom
 * at the same pace a pre-plants world grew its revenue.
 */
const FALLBACK_DEMAND_GROWTH_RATE = 1;

/**
 * Grow each unowned sector's pool one turn.
 *
 * ─── Pre-plants: revenue compounds off CORPORATE growth ────────────────────
 * An unowned sector's ₳ `revenue` grows at half the average `growthRate` of the
 * same-type same-state corporate sectors (1% fallback). That is a nameplate
 * chasing another nameplate: the more corps grow, the more "unowned market"
 * spontaneously appears for them to grow into.
 *
 * ─── Plants (§5 dynamics): headroom tracks the ECONOMY, not the corps ──────
 * Under plants an unowned sector is not a revenue line waiting to be claimed —
 * it is UNMET DEMAND, measured in capacity units, and it is the denominator of
 * market share and the pool every founding build draws from. Compounding it off
 * corporate growth there is actively wrong in two ways:
 *
 *   1. It is circular. Corps expand into headroom; headroom then grows BECAUSE
 *      they expanded. A world can never saturate a market, because serving
 *      demand creates demand. Under plants that circularity also feeds the
 *      build economy directly: unlimited headroom means unlimited profitable
 *      capacity, and the capacity decision stops having a downside.
 *   2. It is phantom. The revenue it compounds is backed by nothing — no
 *      household income, no state output. It was tolerable while unowned
 *      revenue was only a scoreboard; it is not once it prices builds.
 *
 * So under plants the pool tracks the state's own economy instead: headroom
 * grows at the state's `economic.gdpGrowth` (annual %, converted to this turn's
 * share), which is the per-state growth signal already maintained by the metric
 * engine and the cheapest honest one this phase can reach. Demand grows because
 * the economy grew — a supply-side decision to build cannot manufacture the
 * demand that justifies it.
 *
 * `revenue` is written in lockstep from the post-growth units (legacy readers,
 * admin surfaces and every non-plants code path still read it), so the two views
 * never disagree.
 *
 * State-controlled (nationalized) buckets stay frozen in both modes.
 */
export async function processUnownedSectorGrowth(db: Db): Promise<number> {
  const [unownedSectors, corpSectors, nationalCorpIds, plantsEnabled, eraUnitScale] =
    await Promise.all([
      db.collection<UnownedSector>("unownedSectors").find({}).toArray(),
      db.collection<CorporateSector>("corporateSectors").find({}).toArray(),
      loadNationalCorpIds(db),
      getMarketSystemModeForDb(db).then((mode) => marketAtLeast(mode, "plants")),
      loadWorldEraUnitScale(db),
    ]);

  if (unownedSectors.length === 0) return 0;

  // Buckets a National Corporation controls don't regrow unowned market — once a
  // sector is nationalized, the state shouldn't have to keep re-capturing capacity
  // that silently refills under it.
  const stateControlled = computeStateControlledBuckets(corpSectors, nationalCorpIds);

  // Build avg growth rate map: "stateId:sectorType" → avgGrowthRate.
  // Guard against missing/NaN growthRate on legacy docs (treat as 0 contribution)
  // so a single bad sector can't poison the average into NaN.
  const growthAccum = new Map<string, { sum: number; count: number }>();
  for (const sector of corpSectors) {
    const rate = Number.isFinite(sector.currentGrowthRate) ? sector.currentGrowthRate : 0;
    const key = `${sector.stateId}:${sector.sectorType}`;
    const acc = growthAccum.get(key) ?? { sum: 0, count: 0 };
    acc.sum += rate;
    acc.count += 1;
    growthAccum.set(key, acc);
  }

  // Per-state annual GDP growth (%), the plants demand signal. One projected
  // read over a collection already keyed by stateId.
  const gdpGrowthByState = new Map<string, number>();
  if (plantsEnabled) {
    const metricDocs = await db
      .collection<StateMetrics>("macroMetrics")
      .find({}, { projection: { "economic.gdpGrowth": 1 } })
      .toArray();
    for (const doc of metricDocs) {
      const value = doc.economic?.gdpGrowth?.value;
      if (typeof value === "number" && Number.isFinite(value)) {
        gdpGrowthByState.set(String(doc._id), value);
      }
    }
  }

  const now = new Date();
  const ops = unownedSectors.map((u) => {
    if (plantsEnabled) {
      const key = bucketKey(u.stateId, u.sectorType);
      // Nationalized bucket: frozen, same as the legacy path.
      const annualRate = stateControlled.has(key)
        ? 0
        : // Floor at 0. A shrinking economy stops creating new unmet demand; it
          // does not retroactively un-demand what is already there, and letting
          // headroom contract would silently hand market share to incumbents
          // (share is owned / (owned + headroom)) every recession turn.
          Math.max(0, gdpGrowthByState.get(u.stateId) ?? FALLBACK_DEMAND_GROWTH_RATE);
      const perTurnRate = annualRate / GROWTH_RATE_TURNS_PER_YEAR;
      const currentUnits = unownedHeadroomUnitsOf(
        u.sectorType as CorporationType,
        u.headroomUnits,
        u.revenue,
        eraUnitScale
      );
      const newUnits = Math.max(0, currentUnits * (1 + perTurnRate / 100));
      // `revenue` is the derived legacy view here — reconstructed FROM the units
      // rather than grown separately, so the two can never drift apart.
      const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(
        u.sectorType as CorporationType,
        eraUnitScale
      );
      const newRevenue =
        unitsPerAnchor > 0 ? Math.max(0, Math.round(newUnits / unitsPerAnchor)) : 0;
      return {
        updateOne: {
          filter: { _id: u._id },
          update: {
            $set: { headroomUnits: newUnits, revenue: newRevenue, updatedAt: now },
          },
        },
      };
    }
    const key = bucketKey(u.stateId, u.sectorType);
    const acc = growthAccum.get(key);
    // State-controlled bucket: freeze the unowned pool (no regrowth) so the
    // nationalized sector doesn't re-fragment turn over turn.
    const rawAnnualRate = stateControlled.has(key)
      ? 0
      : acc && acc.count > 0
        ? (acc.sum / acc.count) * 0.5
        : FALLBACK_GROWTH_RATE;
    // Corporate growthRate can go negative (down to MIN_GROWTH_RATE = -2) when a corp
    // is intentionally downsizing. The design spec calls for unowned growth to "slow"
    // (not reverse) in that case, so floor the rate at 0 — unowned sectors represent
    // untapped market opportunity and should never contract due to corp-level decisions.
    const annualRate = Math.max(0, rawAnnualRate);
    // growthRate is a per-game-year rate — convert to per-turn to match corporate sectors
    const perTurnRate = annualRate / GROWTH_RATE_TURNS_PER_YEAR;
    // Final safety: if current revenue is NaN (pre-existing corruption), treat as 0
    // so the doc recovers to 0 instead of propagating NaN forward forever.
    const currentRevenue = Number.isFinite(u.revenue) ? u.revenue : 0;
    const newRevenue = Math.max(0, Math.round(currentRevenue * (1 + perTurnRate / 100)));
    return {
      updateOne: {
        filter: { _id: u._id },
        update: { $set: { revenue: newRevenue, updatedAt: now } },
      },
    };
  });

  await db.collection<UnownedSector>("unownedSectors").bulkWrite(ops);
  return ops.length;
}
