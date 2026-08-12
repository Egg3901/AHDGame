import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, State, Union, User } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import {
  duesTrickle,
  decayMembershipPressure,
  UNION_STRENGTH_DECAY_PER_TURN,
} from "@/lib/unions/unionEconomy";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { seedUnions } from "@/lib/admin/seed/seedUnions";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { INACTIVE_CEO_TURN_THRESHOLD } from "@/lib/turn/corporation/inactiveCeoSectorShed";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { processLabourRelationsTurn } from "./labourRelationsTurn";

export interface UnionsTurnResult {
  unionsProcessed: number;
  vacatedForInactivity: number;
  campaignsMovedToDispute: number;
  agreementsExpired: number;
  mediationsExpired: number;
}

/**
 * v3 Phase 8 turn-processing pass: per-turn treasury accrual ("dues",
 * proportional to `membershipPressure`) and `membershipPressure` decay
 * toward 0 for every OWNED union. Unowned unions are skipped entirely — no
 * treasury/pressure changes — so Phase 5's NPC drift stays untouched for
 * their sectors ("conversion not reinvention").
 *
 * Also auto-vacates leadership for leaders inactive beyond
 * `INACTIVE_CEO_TURN_THRESHOLD` turns — reuses the exact same constant and
 * `User.lastActivity`/`createdAt` signal as `inactiveCeoSectorShed.ts`'s CEO
 * analog (code-review fix #5: unions previously had no vacancy mechanism at
 * all, unlike CEOs, so one inactive leader permanently locked an industry).
 * A vacated union is excluded from this turn's dues/decay (it's no longer
 * owned as of this turn).
 *
 * Decay is a flat per-turn constant applied regardless of whether the
 * leader ran a recruitment drive that turn (a deliberate simplification —
 * tracking "did they recruit this turn" would need extra state for a small
 * behavioral difference; an active leader who recruits every turn still
 * nets upward since the recruit gain at low pressure is far larger than the
 * decay).
 *
 * Gated on `labourSystemMode >= "full"` (code-review fix #10) — previously
 * this ran unconditionally, so disabling the feature after testing still
 * silently decayed every union's membershipPressure forever with no way for
 * a (now locked-out) leader to counteract it. Skipping while disabled
 * freezes state instead.
 *
 * Registered in `src/simulation/phases/turnPhaseRegistry.ts` immediately
 * after `"corporationTurn"` — reads sector `unionization` state that phase
 * writes this same turn (via `sectorCalculations.ts`'s `membershipPressure`
 * consumption in `unionizationDriftTarget`), though this pass itself only
 * touches `unions`/`characters` documents.
 */
export async function processUnionsTurn(db: Db): Promise<UnionsTurnResult> {
  if (!(await isLabourFullMode())) {
    return {
      unionsProcessed: 0,
      vacatedForInactivity: 0,
      campaignsMovedToDispute: 0,
      agreementsExpired: 0,
      mediationsExpired: 0,
    };
  }

  const labourRelations = await processLabourRelationsTurn(db, await getCurrentTurn(db));

  // Safety net: at "full" the roster must be COMPLETE — one union per
  // (country, sectorType) for every seeded country (unions are only ever
  // created by seedUnions: bootstrap, the admin seed target, or the
  // labour-config flip into "full"). A count below that expected total means
  // the roster was never seeded OR was only partially seeded — e.g. a swallowed
  // error in the labour-flip's auto-seed, or a lone stray doc from an early
  // partial seed (the exact state the 1953 sandbox was stuck in: 1 of 391).
  // Backfill with the idempotent reset:false upsert; `$setOnInsert` fills the
  // missing slots and preserves every existing (possibly claimed) union.
  // Comparing against the expected total, not just 0, is what heals a partial
  // roster — a single stray doc must never permanently block the backfill.
  const unionCount = await db.collection<Union>("unions").countDocuments({});
  const seededCountryIds = await db
    .collection<State>("states")
    .distinct("countryId", { _id: { $not: /^NATIONAL_/ } });
  const expectedUnionCount = seededCountryIds.length * CORPORATION_TYPES.length;
  if (unionCount < expectedUnionCount) {
    console.warn(
      `[unionsTurn] labourSystemMode is 'full' but union roster is incomplete (${unionCount}/${expectedUnionCount}) — backfilling via seedUnions(reset:false)`
    );
    await seedUnions(
      db,
      (msg) => console.warn(`[unionsTurn] ${msg}`),
      await getGameStatePresetOrDefault(db),
      false
    );
  }

  // Union strength decay. Unlike dues and pressure this runs for EVERY union,
  // led or not, and for every organizer's banked total alongside it, because
  // strength is built by the rank and file rather than by a president: an
  // unowned union that nobody organizes must bleed power too, and the vote
  // weights have to decay in step with the pool they came from or the two
  // numbers drift apart. Suspended unions stay frozen, same as dues.
  const suspendedUnionIds = await db
    .collection<Union>("unions")
    .distinct("_id", { suspended: true });
  const strengthDecayMultiplier = 1 - UNION_STRENGTH_DECAY_PER_TURN;
  const decayStamp = new Date();
  await Promise.all([
    db
      .collection<Union>("unions")
      .updateMany(
        { _id: { $nin: suspendedUnionIds }, strength: { $gt: 0 } },
        { $mul: { strength: strengthDecayMultiplier }, $set: { updatedAt: decayStamp } }
      ),
    db
      .collection<UnionOrganizer>("unionOrganizers")
      .updateMany(
        { unionId: { $nin: suspendedUnionIds }, strength: { $gt: 0 } },
        { $mul: { strength: strengthDecayMultiplier }, $set: { updatedAt: decayStamp } }
      ),
  ]);

  const owned = await db
    .collection<Union>("unions")
    .find(
      // Union ban (player suggestion #93): suspended unions (country under an
      // enacted ban) are frozen — no dues, no pressure decay, no inactivity
      // vacancy — so a repeal restores them exactly as the ban found them.
      { ownerId: { $ne: null }, suspended: { $ne: true } },
      { projection: { _id: 1, ownerId: 1, ownerType: 1, treasury: 1, membershipPressure: 1 } }
    )
    .toArray();

  if (owned.length === 0) {
    return { unionsProcessed: 0, vacatedForInactivity: 0, ...labourRelations };
  }

  const now = new Date();

  // Inactivity auto-vacancy — mirrors isInactiveCeoPenaltyCandidate's
  // lastActivity/createdAt lookup exactly.
  const ownerIds = owned.map((u) => u.ownerId).filter((id): id is ObjectId => id != null);
  const owners = ownerIds.length
    ? await db
        .collection<Character>("characters")
        .find({ _id: { $in: ownerIds } }, { projection: { _id: 1, userId: 1 } })
        .toArray()
    : [];
  const userIdByCharacterId = new Map(owners.map((c) => [c._id.toString(), c.userId]));
  const userIds = Array.from(new Set(owners.map((c) => c.userId.toString()))).map(
    (s) => new ObjectId(s)
  );
  const users = userIds.length
    ? await db
        .collection<User>("users")
        .find({ _id: { $in: userIds } })
        .project<{ _id: ObjectId; lastActivity?: Date; createdAt?: Date }>({
          _id: 1,
          lastActivity: 1,
          createdAt: 1,
        })
        .toArray()
    : [];
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  const cutoffMs = now.getTime() - INACTIVE_CEO_TURN_THRESHOLD * MS_PER_TURN;

  const vacatedUnionIds: ObjectId[] = [];
  const vacatedCharacterIds: ObjectId[] = [];
  const stillOwned: typeof owned = [];
  for (const union of owned) {
    // NPP leaders have no User behind them, so the lastActivity signal this
    // sweep is built on does not apply — they are never "inactive". Without
    // this they would survive only by accident (the characters lookup misses,
    // `reference` comes back undefined and the branch falls through), which is
    // too fragile to rely on.
    if (union.ownerType === "npp") {
      stillOwned.push(union);
      continue;
    }
    const characterId = union.ownerId?.toString();
    const userId = characterId ? userIdByCharacterId.get(characterId) : undefined;
    const user = userId ? userById.get(userId.toString()) : undefined;
    const reference = user?.lastActivity ?? user?.createdAt;
    if (reference && reference.getTime() < cutoffMs) {
      vacatedUnionIds.push(union._id);
      if (union.ownerId) vacatedCharacterIds.push(union.ownerId);
    } else {
      stillOwned.push(union);
    }
  }

  if (vacatedUnionIds.length > 0) {
    await db
      .collection<Union>("unions")
      .updateMany({ _id: { $in: vacatedUnionIds } }, { $set: { ownerId: null, updatedAt: now } });
    await db
      .collection<Character>("characters")
      .updateMany(
        { _id: { $in: vacatedCharacterIds } },
        { $set: { unionLeaderOf: null, updatedAt: now } }
      );
  }

  if (stillOwned.length > 0) {
    const ops = stillOwned.map((u) => ({
      updateOne: {
        filter: { _id: u._id },
        update: {
          $inc: { treasury: duesTrickle(u.membershipPressure) },
          $set: {
            membershipPressure: decayMembershipPressure(u.membershipPressure),
            updatedAt: now,
          },
        },
      },
    }));
    await db.collection<Union>("unions").bulkWrite(ops);
  }

  return {
    unionsProcessed: stillOwned.length,
    vacatedForInactivity: vacatedUnionIds.length,
    ...labourRelations,
  };
}
