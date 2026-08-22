import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { UnownedSector } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { computeUnownedSeedRevenue } from "@/lib/admin/seed/seedUnownedSectors";
import type { CountryId } from "@/lib/constants/countries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  computeSectorDistressRanking,
  distressRankingToBoostMap,
} from "@/lib/economy/sectorDistress";
import {
  bucketKey,
  loadNationalCorpIds,
  loadSeedProtectedBucketKeys,
} from "@/lib/nationalization/stateControlledBuckets";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { computeUnownedHeadroomUnits, unownedPoolBoostSet } from "@/lib/market/unownedHeadroom";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

// Max per-year revenue boost applied to the most distressed sector type (linearly
// scaled down the distress ranking). Raised 0.02 → 0.06 (audit t786): at 0.02 the
// once-a-year auto-seed moved supply far too slowly to close persistent shortages
// (iron/energy/gas all sat at ~0.3× S/D for ~10 game years). 0.06 lets a maximally
// distressed sector recover ~6%/yr of revenue-backed supply without the unbounded
// compounding the old $inc approach caused.
const AUTO_SEED_MAX_BOOST = 0.06;

/**
 * Owned plant capacity per `state:sectorType` bucket, in the SAME units
 * `unownedSectors.headroomUnits` is denominated in.
 *
 * Under plants `capitalStock` IS a sector's capacity in output units/day, which
 * is exactly the basis `computeUnownedHeadroomUnits` converts pool revenue onto
 * (both route through `impliedOutputUnits`). So the two are directly comparable
 * and `headroomUnits >= ownedUnits` means "more of this market is still
 * claimable than anyone has actually built".
 */
async function loadOwnedCapacityByBucket(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .collection("corporateSectors")
    .aggregate<{ _id: { stateId: string; sectorType: string }; units: number }>([
      {
        $group: {
          _id: { stateId: "$stateId", sectorType: "$sectorType" },
          units: { $sum: { $ifNull: ["$capitalStock", 0] } },
        },
      },
    ])
    .toArray();
  const byBucket = new Map<string, number>();
  for (const row of rows) {
    if (!row?._id?.stateId || !row._id.sectorType) continue;
    const units = Number.isFinite(row.units) ? Math.max(0, row.units) : 0;
    byBucket.set(bucketKey(row._id.stateId, row._id.sectorType), units);
  }
  return byBucket;
}

export async function processAutoSectorSeed(
  db: Db,
  currentTurn: number,
  preloadedGameState?: { autoSectorSeedEnabled?: boolean; lastAutoSeedTurn?: number }
): Promise<{ seeded: boolean; sectorsUpdated: number }> {
  if (!preloadedGameState?.autoSectorSeedEnabled) {
    return { seeded: false, sectorsUpdated: 0 };
  }
  const lastSeedTurn = preloadedGameState?.lastAutoSeedTurn ?? 0;
  if (currentTurn - lastSeedTurn < TURNS_PER_YEAR) {
    return { seeded: false, sectorsUpdated: 0 };
  }

  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const eraUnitScale = await loadWorldEraUnitScale(db);
  const ranking = await computeSectorDistressRanking(db);
  const boostMap = distressRankingToBoostMap(ranking, AUTO_SEED_MAX_BOOST);
  const [redirectBuckets, nationalCorpIds, ownedCapacityByBucket] = await Promise.all([
    loadSeedProtectedBucketKeys(db),
    loadNationalCorpIds(db),
    // Only needed to gate the boost under plants; below plants the pool leads in
    // ₳ and there is nothing unit-denominated to compare against.
    plantsEnabled ? loadOwnedCapacityByBucket(db) : Promise.resolve(new Map<string, number>()),
  ]);
  const natCorpObjectIds = [...nationalCorpIds].map((id) => new ObjectId(id));

  const states = await db
    .collection<State>("states")
    .find({ _id: { $not: /^NATIONAL_/ } })
    .toArray();

  const existingDocs = await db
    .collection<UnownedSector>("unownedSectors")
    .find({})
    .project({ stateId: 1, sectorType: 1 })
    .toArray();
  const existingSet = new Set(
    existingDocs.map(
      (d) => `${(d as { stateId: string }).stateId}:${(d as { sectorType: string }).sectorType}`
    )
  );

  const now = new Date();
  let sectorsUpdated = 0;
  // Seed at the WORLD's era. This used to ride the seed helper's
  // "2019-default" parameter default, so a 1953 world grew modern sector
  // revenue mid-turn.
  const preset = await getGameStatePresetOrDefault(db);

  for (const sectorType of CORPORATION_TYPES) {
    const boost = boostMap.get(sectorType as CorporationType) ?? 0;
    if (boost <= 0) continue;

    const multiplier = 1 + boost;

    const sectorDocs = await db
      .collection<UnownedSector>("unownedSectors")
      .find({ sectorType })
      .toArray();
    const openIds = sectorDocs
      .filter((u) => !redirectBuckets.has(bucketKey(u.stateId, u.sectorType)))
      // ─── Cap the boost against actually-built capacity (#1145) ────────────
      //
      // The boost is a $multiply, so it compounds every year a commodity stays
      // distressed. Nothing else grows the pool and only founding/building draw
      // it down, so a market nobody is building into inflated indefinitely —
      // and "Unowned 60.6%" on a market that is fully built out is precisely
      // what players hit when the expand gate (a real demand gap) then refuses
      // the build.
      //
      // Distress relief is meant to open room in markets that are genuinely
      // thin. A bucket already holding more claimable headroom than the world
      // has built plant is not thin, so it is skipped. Plants-gated: below
      // plants the pool leads in ₳ and there is no comparable unit figure, so
      // that path is byte-identical to before.
      .filter((u) => {
        if (!plantsEnabled) return true;
        const owned = ownedCapacityByBucket.get(bucketKey(u.stateId, u.sectorType)) ?? 0;
        const headroom =
          typeof u.headroomUnits === "number" && Number.isFinite(u.headroomUnits)
            ? u.headroomUnits
            : computeUnownedHeadroomUnits(
                u.sectorType as CorporationType,
                u.revenue ?? 0,
                eraUnitScale
              );
        return headroom < owned;
      })
      .map((u) => u._id);
    if (openIds.length > 0) {
      // ONE shared pipeline with the admin `seed-unowned` route: which leg leads
      // flips with the market tier (revenue below plants, headroomUnits under it),
      // and the two callers had already drifted apart on exactly that. See
      // `unownedPoolBoostSet`.
      const boostPipeline = {
        $set: unownedPoolBoostSet(
          sectorType as CorporationType,
          multiplier,
          now,
          plantsEnabled,
          eraUnitScale
        ),
      };
      const { modifiedCount } = await db
        .collection<UnownedSector>("unownedSectors")
        .updateMany({ _id: { $in: openIds } }, [boostPipeline]);
      sectorsUpdated += modifiedCount;
    }
    // Natcorp corporate sectors get the same $multiply boost as open unowned markets.
    // Using $multiply (not $inc) keeps growth proportional and self-limiting.
    // The old approach used $inc which compounded unboundedly (UK energy runaway).
    if (natCorpObjectIds.length > 0) {
      const { modifiedCount: natModified } = await db
        .collection("corporateSectors")
        .updateMany({ sectorType, corporationId: { $in: natCorpObjectIds } }, [
          {
            $set: {
              revenue: { $round: [{ $multiply: ["$revenue", multiplier] }, 0] },
              // UNITS LEAD under plants. `corporateSectors.revenue` is DERIVED
              // there — `sectorTurn` restates it from `capitalStock × mix price`
              // every turn — so boosting revenue alone is erased on the next
              // tick and the natcorp never receives the distress relief. The
              // multiplier is scale-free, so applying the SAME factor to
              // capacity keeps the two legs in exact lockstep (no ₳ → units
              // conversion, and therefore no rounding drift between them).
              ...(plantsEnabled
                ? {
                    capitalStock: {
                      $multiply: [{ $ifNull: ["$capitalStock", 0] }, multiplier],
                    },
                  }
                : {}),
              updatedAt: now,
            },
          },
        ]);
      sectorsUpdated += natModified;
    }

    for (const state of states) {
      const key = bucketKey(state._id as string, sectorType);
      if (existingSet.has(key)) continue;
      // Do not create or grow sectors in nationalized markets.
      if (redirectBuckets.has(key)) continue;

      const seedRevenue = computeUnownedSeedRevenue({
        gdp: state.gdp,
        countryId: state.countryId as CountryId,
        stateId: state._id as string,
        preset,
        sectorType,
        boostMultiplier: multiplier,
      });

      await db.collection<UnownedSector>("unownedSectors").insertOne({
        _id: new ObjectId(),
        stateId: state._id as string,
        countryId: state.countryId as CountryId,
        sectorType,
        revenue: seedRevenue,
        // Derived from revenue — these inserts omitted it entirely, so every
        // mid-game auto-seeded market was born without the field.
        headroomUnits: computeUnownedHeadroomUnits(
          sectorType as CorporationType,
          seedRevenue,
          eraUnitScale
        ),
        createdAt: now,
        updatedAt: now,
      });
      existingSet.add(key);
      sectorsUpdated++;
    }
  }

  await db
    .collection("gameState")
    .updateOne({}, { $set: { lastAutoSeedTurn: currentTurn, updatedAt: now } });

  return { seeded: true, sectorsUpdated };
}
