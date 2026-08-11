import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { Union } from "@/lib/db/types";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { getUnionName } from "@/lib/unions/unionNames";

/** Membership pressure every union is seeded with — above the wage-demand
 *  threshold (NPP_DEMAND_MIN_PRESSURE = 15) so bargaining is active from the
 *  start, but below LEADERSHIP_ELECTION_MIN_PRESSURE (25), so seeded unions in
 *  player worlds do not open with a leadership election already triggered. */
export const SEED_MEMBERSHIP_PRESSURE = 20;

/**
 * Idempotent seed of one vacant-head union per (countryId, sectorType) for
 * every country present in `states`. Names are era-appropriate where authored
 * in `src/lib/seeds/reference/unionNames.ts`, with a generic fallback.
 *
 * On `reset=true`, wipes `unions` and `unionEndorsements` first so a world
 * reset always starts with a clean vacant roster. On idempotent re-runs,
 * `$setOnInsert` preserves any claimed union's runtime state.
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
  const ops: AnyBulkWriteOperation<Union>[] = [];

  for (const rawCountryId of countryIds) {
    const countryId = rawCountryId as CountryId;
    for (const sectorType of CORPORATION_TYPES) {
      const name = getUnionName(countryId, sectorType, preset);
      ops.push({
        updateOne: {
          filter: { countryId, sectorType },
          update: {
            $setOnInsert: {
              countryId,
              sectorType,
              name,
              ownerId: null,
              pendingLeaderCharacterId: null,
              treasury: 0,
              // Unions start already organised rather than from nothing. At 0 the
              // shop floor takes many turns of recruiting to cross the threshold
              // where a leader will post a wage demand (recruit adds ~8/turn
              // against a 0.5/turn decay), so a 10-turn window showed 408 led
              // unions posting zero demands and calling zero strikes — the whole
              // bargaining loop looked dead when it was merely still organising.
              // Seeding at the demand threshold means wage bargaining is live from
              // the first turns and is actually exercised over a long run.
              membershipPressure: SEED_MEMBERSHIP_PRESSURE,
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
  }

  if (ops.length > 0) {
    const result = await db.collection<Union>("unions").bulkWrite(ops, { ordered: true });
    upserted = result.upsertedCount;
  }

  const total = countryIds.length * CORPORATION_TYPES.length;
  log(
    `Seeded unions: ${upserted} inserted, ${total} total slots for ${countryIds.length} countries (preset ${preset})`
  );
  return upserted;
}
