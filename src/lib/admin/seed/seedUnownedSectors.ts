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
 * Per-country, per-sector seed multiplier for DOWNSTREAM (input-consuming)
 * industry — additive capacity on top of the normalised sector-weight share,
 * not a redistribution of it (ticket-1072).
 *
 * WHY A MULTIPLIER AND NOT A WEIGHT BUMP. `computeUnownedSeedRevenue` sizes a
 * bucket from the country's NORMALISED sector weight, so raising one weight
 * lowers every other sector's share. East Germany's problem is not the shape of
 * its mix, it is that its downstream consumers are absolutely too small against
 * its upstream producers: on the live 1953 world DD carries ~63.1k units of
 * steel SUPPLY against ~10.8k units of steel DEMAND, while Czechoslovakia at a
 * smaller population runs ~95.8k supply against ~80.4k demand. Re-weighting
 * inside a fixed pie tops out near 1.4x; the country needs more downstream
 * plant, not a different slice of the same plant.
 *
 * WHY DD, AND WHY CONSTRUCTION CARRIES THE STEEL ROLE. The CoCom embargo walls
 * DD steel out of the West, so it cannot export the surplus away, and private
 * founding is banned in a command economy, so no player can build the missing
 * consumers. Construction (the Aufbau/Stalinallee programme, steel demand rate
 * 0.15) is the real downstream steel sink and is multiplied x8 to soak the
 * lignite-fed steel glut.
 *
 * WHY AUTOMOBILES IS ONLY x2 (was x10, ticket-1072). Lifting the auto works to
 * x10 back-fired: automobiles OUTPUT is `vehicles`, a commodity DD cannot sell.
 * Every Warsaw Pact neighbour is already net-long vehicles and the West is
 * CoCom-embargoed, so the extra output just piled up unsold (live prod: DD
 * vehicles supply 3544.5 vs demand 341) while a player's nationalized IFA corp
 * bled ~330k/turn on cars nobody buys. And auto consumes only ~5% of DD's steel
 * demand (auto steel rate 0.25 × vehicles output rate 0.5 ≈ 1,772 of ~33,248),
 * so cutting it back does NOT re-open the steel glut construction is sized to
 * close. Kept at x2 for a token IFA/Wartburg/Robur presence, not as a steel sink.
 *
 * `capitalStock` is derived from this same ₳ figure (see `buildSector` in
 * seeds/reference/budgets.ts), so capacity and revenue move together and no
 * existing sector is cut.
 */
export const COUNTRY_SECTOR_SEED_MULTIPLIER: Partial<
  Record<CountryId, Partial<Record<CorporationType, number>>>
> = {
  DD: {
    automobiles: 2,
    construction: 8,
  },
};

/** The downstream seed multiplier for one (country, sector); 1 when unset. */
export function countrySectorSeedMultiplier(countryId: CountryId, sectorType: string): number {
  const value = COUNTRY_SECTOR_SEED_MULTIPLIER[countryId]?.[sectorType as CorporationType];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

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
  // Applied AFTER the era floor so the uplift is real capacity rather than
  // headroom the floor would have swallowed (ticket-1072).
  const downstreamMultiplier = countrySectorSeedMultiplier(countryId, sectorType);
  return Math.round(
    Math.max(getMinUnownedSectorRevenue(preset), Math.round(base * UNOWNED_REVENUE_MULTIPLIER)) *
      countryMultiplier *
      downstreamMultiplier *
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
