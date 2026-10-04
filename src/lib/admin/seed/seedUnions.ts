import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { Union } from "@/lib/db/types";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { getUnionName } from "@/lib/unions/unionNames";
import { BASE_APPROVAL } from "@/lib/unions/unionDues";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";

/**
 * Starting annual dues charged per member on a freshly seeded union. 0, not a
 * guessed currency figure: `duesPerWorkerAnnual` is money, and money means
 * wildly different things across 1953 Nigeria and 2019 America, let alone
 * across every era in between (the same fragility `unionServices.ts`'s
 * fraction-of-wage pricing exists to avoid). A seeded union hasn't had a
 * leader decide to charge anything yet, so it starts at 0, the head who
 * takes over sets the real rate against local wages.
 */
export const SEED_DUES_PER_WORKER_ANNUAL = 0;

/**
 * Idempotent seed of one vacant-head union per (countryId, sectorType) for
 * every country present in `states`, plus the sector representation each of
 * those unions starts out holding. Names are era-appropriate where authored
 * in `src/lib/seeds/reference/unionNames.ts`, with a generic fallback.
 *
 * On `reset=true`, wipes `unions` and `unionEndorsements` first so a world
 * reset always starts with a clean vacant roster. On idempotent re-runs,
 * `$setOnInsert` preserves any claimed union's runtime state (treasury,
 * approval, dues, services, leadership).
 *
 * The upsert filter matches on `foundedByCharacterId` being null or absent, not just
 * `(countryId, sectorType)`, union dues v1 lets a player found a RIVAL union
 * in an industry that already has one, and a rival's document also has that
 * same `(countryId, sectorType)` pair. Without the extra clause, re-running
 * this seed could match and silently touch a player-founded union instead of
 * (or as well as) the one this function owns.
 */
export async function seedUnions(
  db: Db,
  log: (msg: string) => void,
  preset: string,
  reset = false
): Promise<number> {
  if (reset) {
    await Promise.all([
      db.collection("unions").deleteMany({}),
      db.collection("unionEndorsements").deleteMany({}),
      db.collection("unionLeaderVotes").deleteMany({}),
      db.collection("unionOrganizers").deleteMany({}),
    ]);
  }

  const countryIds = await db
    .collection<State>("states")
    .distinct("countryId", { _id: { $not: /^NATIONAL_/ } });

  const now = new Date();
  let upserted = 0;
  const unionOps: AnyBulkWriteOperation<Union>[] = [];
  const pairs: {
    countryId: CountryId;
    sectorType: CorporationType;
    industryModel: CorporateSector["industryModel"];
    mediaDiscriminator: CorporateSector["mediaDiscriminator"];
  }[] = [];

  for (const rawCountryId of countryIds) {
    const countryId = rawCountryId as CountryId;
    for (const sectorType of CORPORATION_TYPES) {
      pairs.push({ countryId, sectorType, industryModel: null, mediaDiscriminator: null });
    }
  }

  // Model-specific markets are seeded from the same sector snapshot that the
  // union assignment below uses. The legacy type slot remains present, while a
  // manufacturing vehicle market gets its own union identity and index key.
  const modelSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {
        $or: [{ industryModel: { $type: "string" } }, { mediaDiscriminator: { $type: "string" } }],
      },
      {
        projection: {
          countryId: 1,
          sectorType: 1,
          industryModel: 1,
          mediaDiscriminator: 1,
        },
      }
    )
    .toArray();
  for (const sector of modelSectors) {
    if (!sector.countryId || (!sector.industryModel && !sector.mediaDiscriminator)) continue;
    const exists = pairs.some(
      (pair) =>
        pair.countryId === sector.countryId &&
        pair.sectorType === sector.sectorType &&
        pair.industryModel === (sector.industryModel ?? null) &&
        pair.mediaDiscriminator === (sector.mediaDiscriminator ?? null)
    );
    if (!exists) {
      pairs.push({
        countryId: sector.countryId,
        sectorType: sector.sectorType,
        industryModel: sector.industryModel ?? null,
        mediaDiscriminator: sector.mediaDiscriminator ?? null,
      });
    }
  }

  for (const { countryId, sectorType, industryModel, mediaDiscriminator } of pairs) {
    const unionType = getOperatingSectorType(
      sectorType,
      industryModel,
      mediaDiscriminator
    ) as CorporationType;
    const name = getUnionName(countryId, unionType, preset);
    unionOps.push({
      updateOne: {
        // `null` matches an explicit null AND an absent field, so this is correct
        // both before and after the founder-null backfill.
        filter: {
          countryId,
          sectorType,
          industryModel,
          mediaDiscriminator,
          foundedByCharacterId: null,
        },
        update: {
          $setOnInsert: {
            countryId,
            sectorType,
            industryModel,
            mediaDiscriminator,
            name,
            ownerId: null,
            pendingLeaderCharacterId: null,
            // Explicit null, not an absent field: the partial unique index on
            // (countryId, sectorType) keys off `$type: "null"`, because a
            // partial index cannot test for an absent field.
            foundedByCharacterId: null,
            treasury: 0,
            // Union dues v1: approval starts at the neutral-but-untested
            // baseline (a union that charges nothing and runs nothing is not
            // disliked, merely unproven), dues at 0 (see
            // SEED_DUES_PER_WORKER_ANNUAL), and no service programmes running.
            approval: BASE_APPROVAL,
            duesPerWorkerAnnual: SEED_DUES_PER_WORKER_ANNUAL,
            activeServices: [],
            lastCalledStrikeTurn: null,
            demandedWageLevel: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  if (unionOps.length > 0) {
    const result = await db.collection<Union>("unions").bulkWrite(unionOps, { ordered: true });
    upserted = result.upsertedCount;
  }

  // Union dues v1: hand each world-seeded union the sectors it starts out
  // holding, every sector matching its (countryId, sectorType) that no union
  // represents yet. Read back the resolved ids (an upsert's `$setOnInsert`
  // doesn't return one for a document that already existed) and only touch
  // sectors with no `representingUnionId`, so this never overwrites a rival's
  // raid or a corp-seeding order this function doesn't control.
  let sectorsAssigned = 0;
  if (pairs.length > 0) {
    const worldUnions = await db
      .collection<Union>("unions")
      .find(
        { foundedByCharacterId: null },
        {
          projection: {
            _id: 1,
            countryId: 1,
            sectorType: 1,
            industryModel: 1,
            mediaDiscriminator: 1,
          },
        }
      )
      .toArray();
    const worldUnionIdByPair = new Map(
      worldUnions.map((u) => [
        `${u.countryId}|${u.sectorType}|${u.industryModel ?? ""}|${u.mediaDiscriminator ?? ""}`,
        u._id,
      ])
    );
    const sectorOps: AnyBulkWriteOperation<CorporateSector>[] = [];
    for (const { countryId, sectorType, industryModel, mediaDiscriminator } of pairs) {
      const unionId = worldUnionIdByPair.get(
        `${countryId}|${sectorType}|${industryModel ?? ""}|${mediaDiscriminator ?? ""}`
      );
      if (!unionId) continue;
      sectorOps.push({
        updateMany: {
          filter: {
            countryId,
            sectorType,
            industryModel,
            mediaDiscriminator,
            representingUnionId: null,
          },
          update: { $set: { representingUnionId: unionId } },
        },
      });
    }
    if (sectorOps.length > 0) {
      const sectorResult = await db
        .collection<CorporateSector>("corporateSectors")
        .bulkWrite(sectorOps, { ordered: false });
      sectorsAssigned = sectorResult.modifiedCount;
    }
  }

  const total = countryIds.length * CORPORATION_TYPES.length;
  log(
    `Seeded unions: ${upserted} inserted, ${total} total slots for ${countryIds.length} countries ` +
      `(preset ${preset}), ${sectorsAssigned} sectors newly represented`
  );
  return upserted;
}
