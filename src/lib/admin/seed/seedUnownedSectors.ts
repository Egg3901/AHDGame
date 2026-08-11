import type { AnyBulkWriteOperation, Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { UnownedSector } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  MODERN_MIN_UNOWNED_SECTOR_REVENUE,
  getEraUnitScale,
  getMinUnownedSectorRevenue,
  getSectorSeedScale,
} from "@/lib/constants/sectorSeedEra";
import { getStateSectorWeights } from "@/lib/seeds/reference/sectorSeedWeights";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import { incrementNatCorpSectorRevenue } from "@/lib/nationalization/seedToNatCorp";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { reconcileCommandEconomyUnowned } from "@/lib/admin/seed/reconcileCommandEconomyUnowned";

/**
 * Modern-era floor. Kept as a named export for existing callers; the value a
 * given seed run actually applies is era-aware — see
 * {@link getMinUnownedSectorRevenue}.
 */
export const MIN_UNOWNED_SECTOR_REVENUE = MODERN_MIN_UNOWNED_SECTOR_REVENUE;
export const UNOWNED_REVENUE_MULTIPLIER = 1.0;
// Per-country uplift removed — the UK 2.53x multiplier was a temporary fix for
// undersized seed revenue that caused runaway commodity supply dominance once
// those sectors were nationalized into the NatCorp and boosted by the auto-seeder.
export const COUNTRY_UNOWNED_REVENUE_MULTIPLIER: Partial<Record<CountryId, number>> = {};

/**
 * Canonical market size (₳) for one (state, sectorType): the single source of
 * truth used by both the seeder and the 1991-recompute heal script. `gdp` is
 * the state's stored GDP (local-currency millions); `usdExchangeRate` normalizes
 * it to ₳, the seed scale + the sector weight shape the market, the result is
 * floored at the era's minimum.
 *
 * Both the scale and the floor are resolved per PRESET (see
 * `constants/sectorSeedEra.ts`): the scale is a GDP multiple and is era-neutral
 * today, but the floor is an absolute ₳ amount calibrated on modern nominal
 * GDP, which pinned every sector of half the 1953 world at exactly the floor.
 * Presets outside the era table (all modern presets, and callers passing no
 * preset) resolve the unchanged modern constants.
 */
export function computeUnownedSeedRevenue(params: {
  gdp: number;
  countryId: CountryId;
  stateId: string;
  sectorType: string;
  preset: string;
  boostMultiplier?: number;
}): number {
  const { gdp, countryId, stateId, sectorType, preset, boostMultiplier = 1 } = params;
  const { usdExchangeRate } = getCountryConfig(countryId, preset);
  const weights = getStateSectorWeights(stateId, countryId, preset);
  const base = Math.round(
    gdp *
      usdExchangeRate *
      getSectorSeedScale(preset) *
      (weights[sectorType as CorporationType] ?? 0)
  );
  const countryMultiplier = COUNTRY_UNOWNED_REVENUE_MULTIPLIER[countryId] ?? 1;
  return Math.round(
    Math.max(getMinUnownedSectorRevenue(preset), Math.round(base * UNOWNED_REVENUE_MULTIPLIER)) *
      countryMultiplier *
      boostMultiplier
  );
}

export async function seedUnownedSectors(
  db: Db,
  log: (msg: string) => void,
  boostMultiplier = 1,
  preset: string,
  // When true, recompute `revenue` for EXISTING docs too (not just inserts).
  // Safe only pre-play: a naive refresh resets a captured pool to full market.
  // For a live world with captured sectors, use the 1991-recompute heal script.
  refresh = false,
  /** Route (state, sectorType) buckets to the National Corporation instead of unowned. */
  redirectToNatCorpBuckets?: ReadonlySet<string>
) {
  const states = await db
    .collection<State>("states")
    .find({ _id: { $not: /^NATIONAL_/ } })
    .toArray();

  const now = new Date();
  let inserted = 0;
  let redirected = 0;
  const ops: AnyBulkWriteOperation<UnownedSector>[] = [];

  // Indexes FIRST, not after the loop. The upserts below filter on
  // {stateId, sectorType}; with the index built afterwards every one of them is
  // a collection scan over a collection growing to ~3,800 docs (~7.4M document
  // examinations). That was invisible while each upsert cost a ~15ms round trip,
  // but the batched write below removes the latency the scan was hiding behind.
  await db
    .collection("unownedSectors")
    .createIndex({ stateId: 1, sectorType: 1 }, { unique: true });
  await db.collection("unownedSectors").createIndex({ countryId: 1 });

  for (const state of states) {
    const countryId = state.countryId;

    for (const sectorType of CORPORATION_TYPES) {
      const bucket = bucketKey(state._id as string, sectorType);
      const seedRevenue = computeUnownedSeedRevenue({
        gdp: state.gdp,
        countryId: countryId as CountryId,
        stateId: state._id as string,
        sectorType,
        preset,
        boostMultiplier,
      });

      if (redirectToNatCorpBuckets?.has(bucket)) {
        const result = await incrementNatCorpSectorRevenue(db, {
          countryId: countryId as CountryId,
          stateId: state._id as string,
          sectorType: sectorType as CorporationType,
          revenueDelta: seedRevenue,
        });
        if (result !== "noop") redirected++;
        continue;
      }
      // Identity fields are immutable; mutable fields (revenue/countryId/updatedAt)
      // go in $set only on refresh so $set and $setOnInsert never share a key.
      const identity = {
        _id: new ObjectId(),
        stateId: state._id as string,
        sectorType,
        createdAt: now,
      };
      // Batched (this branch) AND carrying the derived headroom field
      // (development). `headroomUnits` is DERIVED from revenue and must be
      // written in the SAME operation, or it is left describing a revenue
      // figure that no longer exists — `plants` reads it as the market
      // denominator. The batching changes the number of round trips, not what
      // each document ends up holding.
      const headroomUnits = computeUnownedHeadroomUnits(
        sectorType as CorporationType,
        seedRevenue,
        getEraUnitScale(preset)
      );
      ops.push({
        updateOne: {
          filter: { stateId: state._id as string, sectorType },
          update: refresh
            ? {
                $set: { revenue: seedRevenue, headroomUnits, countryId, updatedAt: now },
                $setOnInsert: identity,
              }
            : {
                $setOnInsert: {
                  ...identity,
                  countryId,
                  revenue: seedRevenue,
                  headroomUnits,
                  updatedAt: now,
                },
              },
          upsert: true,
        },
      });
    }
  }

  // `ordered: true` preserves the sequential semantics this replaced: ops apply
  // in loop order, and a failure skips the remainder exactly as a thrown await
  // did. The win here is round trips, not server-side parallelism.
  if (ops.length > 0) {
    const result = await db
      .collection<UnownedSector>("unownedSectors")
      .bulkWrite(ops, { ordered: true });
    inserted = result.upsertedCount;
  }

  const redirectNote = redirected > 0 ? `, routed ${redirected} to national corporations` : "";
  log(
    `Seeded ${inserted} unowned sector docs (${states.length} states × ${CORPORATION_TYPES.length} types${redirectNote})`
  );

  // Command economies seed SOEs at full market size, then this seeder also
  // inserts a full unowned twin — ownership lands near ~50% and non-SOE
  // sectors stay unreachable ghosts (ticket #1014). Drain after the upserts.
  await reconcileCommandEconomyUnowned(db, { preset, log });
}
