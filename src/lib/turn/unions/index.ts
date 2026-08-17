import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, CorporateSector, State, Union, User } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { UNION_STRENGTH_DECAY_PER_TURN } from "@/lib/unions/unionEconomy";
import {
  approvalTarget,
  averageAnnualWage,
  duesIncomePerTurn,
  maxDuesForWage,
  servicesCostPerTurn,
  trendApproval,
  unionApproval,
  unionMembers,
} from "@/lib/unions/unionDues";
import { normalizeServiceIds } from "@/lib/unions/unionServices";
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
  /** Sectors handed to their industry's seeded union this turn (see `adoptUnrepresentedSectors`). */
  sectorsAdopted: number;
  campaignsMovedToDispute: number;
  agreementsExpired: number;
  mediationsExpired: number;
}

/**
 * Give every sector that nobody represents to the seeded union for its
 * (countryId, sectorType), and report how many were adopted.
 *
 * Union dues v1 replaced implicit coverage (a union covered every sector
 * matching its country and industry) with an explicit
 * `CorporateSector.representingUnionId` pointer, but nothing ever populated
 * that pointer for the sectors that already existed. The result on a live world
 * was that NO sector pointed at any union, so every union had 0 members, 0
 * average wage, no dues base, and an approval target stuck at the 55 base: the
 * union pages showed no workers, approval was identical everywhere, and
 * switching services on changed nothing because there were no represented
 * sectors to change.
 *
 * Doing this in the turn rather than as a one-shot migration is deliberate.
 * Sectors are created in several places (world seeding, NPP founding, player
 * expansion), and none of them know about unions, so a migration would fix
 * today's world and silently leak new unrepresented sectors forever. This is
 * the same "conversion not reinvention" shape as the roster backfill above.
 *
 * Only SEEDED unions adopt (no `foundedByCharacterId`), which is the one union
 * per industry the partial unique index still guarantees. A sector already
 * pointing somewhere is never touched, so a rival that won a shop keeps it, and
 * losing a raid does not hand the shop back on the next turn.
 */
export async function adoptUnrepresentedSectors(db: Db): Promise<number> {
  const unrepresented = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ representingUnionId: null }, { projection: { _id: 1, countryId: 1, sectorType: 1 } })
    .toArray();
  if (unrepresented.length === 0) return 0;

  const seededUnions = await db
    .collection<Union>("unions")
    .find(
      { foundedByCharacterId: { $exists: false } },
      { projection: { _id: 1, countryId: 1, sectorType: 1 } }
    )
    .toArray();
  const seededByKey = new Map(seededUnions.map((u) => [`${u.countryId}|${u.sectorType}`, u._id]));

  const now = new Date();
  const ops = [];
  for (const sector of unrepresented) {
    const unionId = seededByKey.get(`${sector.countryId}|${sector.sectorType}`);
    // No seeded union for this industry (a country the roster never covered)
    // leaves the sector unrepresented rather than inventing a union for it.
    if (!unionId) continue;
    ops.push({
      updateOne: {
        filter: { _id: sector._id, representingUnionId: null },
        update: { $set: { representingUnionId: unionId, updatedAt: now } },
      },
    });
  }
  if (ops.length === 0) return 0;
  const result = await db.collection<CorporateSector>("corporateSectors").bulkWrite(ops);
  return result.modifiedCount ?? 0;
}

/**
 * Union dues v1 turn-processing pass, for every OWNED, non-suspended union:
 * resolve the sectors it represents (`CorporateSector.representingUnionId`),
 * derive real `members` and their member-weighted `averageAnnualWage` from
 * those sectors, credit `duesIncomePerTurn`, debit `servicesCostPerTurn`, and
 * trend `approval` toward `approvalTarget`. Unowned unions are skipped
 * entirely: no treasury/approval changes, so Phase 5's NPC drift stays
 * untouched for the sectors they represent ("conversion not reinvention").
 *
 * The service bill NEVER pushes the treasury negative: if this turn's dues
 * income can't cover it, the services LAPSE (no charge, `servicesLapsed:
 * true` into `approvalTarget` so the unfunded slate stops paying approval
 * too: an unfunded promise earns nothing).
 *
 * Also auto-vacates leadership for leaders inactive beyond
 * `INACTIVE_CEO_TURN_THRESHOLD` turns, reuses the exact same constant and
 * `User.lastActivity`/`createdAt` signal as `inactiveCeoSectorShed.ts`'s CEO
 * analog (code-review fix #5: unions previously had no vacancy mechanism at
 * all, unlike CEOs, so one inactive leader permanently locked an industry).
 * A vacated union is excluded from this turn's dues/services/approval (it's
 * no longer owned as of this turn).
 *
 * Gated on `labourSystemMode >= "full"` (code-review fix #10), previously
 * this ran unconditionally, so disabling the feature after testing still
 * silently moved every union's treasury/approval forever with no way for a
 * (now locked-out) leader to counteract it. Skipping while disabled freezes
 * state instead.
 *
 * Registered in `src/simulation/phases/turnPhaseRegistry.ts` immediately
 * after `"corporationTurn"`, reads sector `unionization`/`workers`/
 * `wagePerWorker` state that phase writes this same turn, though this pass
 * itself only touches `unions`/`characters` documents (and reads
 * `corporateSectors`).
 */

export async function processUnionsTurn(db: Db): Promise<UnionsTurnResult> {
  if (!(await isLabourFullMode())) {
    return {
      unionsProcessed: 0,
      vacatedForInactivity: 0,
      sectorsAdopted: 0,
      campaignsMovedToDispute: 0,
      agreementsExpired: 0,
      mediationsExpired: 0,
    };
  }

  const labourRelations = await processLabourRelationsTurn(db, await getCurrentTurn(db));

  // Safety net: at "full" the roster must be COMPLETE, one union per
  // (country, sectorType) for every seeded country (unions are only ever
  // created by seedUnions: bootstrap, the admin seed target, or the
  // labour-config flip into "full"). A count below that expected total means
  // the roster was never seeded OR was only partially seeded, e.g. a swallowed
  // error in the labour-flip's auto-seed, or a lone stray doc from an early
  // partial seed (the exact state the 1953 sandbox was stuck in: 1 of 391).
  // Backfill with the idempotent reset:false upsert; `$setOnInsert` fills the
  // missing slots and preserves every existing (possibly claimed) union.
  // Comparing against the expected total, not just 0, is what heals a partial
  // roster, a single stray doc must never permanently block the backfill.
  const unionCount = await db.collection<Union>("unions").countDocuments({});
  const seededCountryIds = await db
    .collection<State>("states")
    .distinct("countryId", { _id: { $not: /^NATIONAL_/ } });
  const expectedUnionCount = seededCountryIds.length * CORPORATION_TYPES.length;
  if (unionCount < expectedUnionCount) {
    console.warn(
      `[unionsTurn] labourSystemMode is 'full' but union roster is incomplete (${unionCount}/${expectedUnionCount}), backfilling via seedUnions(reset:false)`
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

  const sectorsAdopted = await adoptUnrepresentedSectors(db);
  if (sectorsAdopted > 0) {
    console.warn(
      `[unionsTurn] adopted ${sectorsAdopted} unrepresented sector(s) into their industry's seeded union`
    );
  }

  const owned = await db
    .collection<Union>("unions")
    .find(
      // Union ban (player suggestion #93): suspended unions (country under an
      // enacted ban) are frozen, no dues, no services, no approval trend, no
      // inactivity vacancy, so a repeal restores them exactly as the ban found them.
      { ownerId: { $ne: null }, suspended: { $ne: true } },
      {
        projection: {
          _id: 1,
          ownerId: 1,
          ownerType: 1,
          treasury: 1,
          duesPerWorkerAnnual: 1,
          activeServices: 1,
          approval: 1,
        },
      }
    )
    .toArray();

  if (owned.length === 0) {
    return { unionsProcessed: 0, vacatedForInactivity: 0, sectorsAdopted, ...labourRelations };
  }

  const now = new Date();

  // Inactivity auto-vacancy, mirrors isInactiveCeoPenaltyCandidate's
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
    // sweep is built on does not apply, they are never "inactive". Without
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
    const stillOwnedIds = stillOwned.map((u) => u._id);
    const representedSectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { representingUnionId: { $in: stillOwnedIds } },
        { projection: { representingUnionId: 1, workers: 1, unionization: 1, wagePerWorker: 1 } }
      )
      .toArray();
    const sectorsByUnionId = new Map<string, CorporateSector[]>();
    for (const sector of representedSectors) {
      const key = sector.representingUnionId!.toString();
      const list = sectorsByUnionId.get(key);
      if (list) list.push(sector);
      else sectorsByUnionId.set(key, [sector]);
    }

    const ops = stillOwned.map((u) => {
      const sectors = sectorsByUnionId.get(u._id.toString()) ?? [];
      const members = unionMembers(sectors);
      const annualWage = averageAnnualWage(sectors);
      const activeServices = normalizeServiceIds(u.activeServices);
      // Re-clamp the stored rate against TODAY's wages: setUnionDues clamps at
      // write time, but wages can fall (or high-wage shops can be lost) after
      // the rate was set, and the engine must never charge above the 10%
      // ceiling the API and the display both enforce.
      const duesRate = Math.min(
        Math.max(0, u.duesPerWorkerAnnual ?? 0),
        maxDuesForWage(annualWage)
      );
      const duesIncome = duesIncomePerTurn(members, duesRate);
      const fullServicesCost = servicesCostPerTurn(members, annualWage, activeServices);
      // The service bill never pushes the treasury negative: if this turn's
      // dues income can't cover it, the whole slate lapses for the turn (no
      // partial charge) and earns no approval bonus.
      const affordableTreasury = u.treasury + duesIncome;
      const servicesLapsed = fullServicesCost > affordableTreasury;
      const servicesCost = servicesLapsed ? 0 : fullServicesCost;
      const target = approvalTarget({
        duesPerWorkerAnnual: duesRate,
        annualWage,
        activeServices,
        servicesLapsed,
      });
      const newApproval = trendApproval(unionApproval(u), target);
      return {
        updateOne: {
          filter: { _id: u._id },
          update: {
            $inc: { treasury: duesIncome - servicesCost },
            $set: { approval: newApproval, updatedAt: now },
          },
        },
      };
    });
    await db.collection<Union>("unions").bulkWrite(ops);
  }

  return {
    unionsProcessed: stillOwned.length,
    sectorsAdopted,
    vacatedForInactivity: vacatedUnionIds.length,
    ...labourRelations,
  };
}
