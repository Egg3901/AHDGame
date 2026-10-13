import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial, GovernorOfficeState } from "@/lib/db/types";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { initialVpActionFields, VP_ACTION_CAP } from "@/lib/constants/vicePresidentActions";
import { initialJusticeActionFields, JUSTICE_ACTION_CAP } from "@/lib/constants/justiceActions";
import { GUBERNATORIAL_ACTION_CAP } from "@/lib/constants/governorOffice";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  ensureUkSharedPool,
  resolveMinisterialRemaining,
  usesSharedMinisterialPool,
} from "@/lib/cabinet/ministerialActionPool";
import { resolveOfficeAccess } from "@/lib/governorOffice/access";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import {
  OFFICE_POOL_TOP_UP_AP_COST,
  officePoolTopUpBlock,
  type OfficePoolKind,
} from "./officePoolTopUpRules";

export { OFFICE_POOL_TOP_UP_AP_COST } from "./officePoolTopUpRules";
export type { OfficePoolKind } from "./officePoolTopUpRules";

export type OfficePoolTarget =
  | { kind: "ministerial"; countryId: CountryId; positionId: string }
  | { kind: "vp"; countryId: CountryId }
  | { kind: "justice"; countryId: CountryId; seatNumber: number }
  | { kind: "gubernatorial"; countryId: CountryId; stateId: string };

export type OfficePoolTopUpResult =
  | { ok: true; kind: OfficePoolKind; remaining: number; cap: number; actionsLeft: number }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/** A resolved pool document the holder may credit. */
interface ResolvedPool {
  collection:
    | "cabinetMembers"
    | "characters"
    | "electedOfficials"
    | "supremeCourtSeats"
    | "governorOfficeState";
  docId: unknown;
  field: string;
  topUpField: string;
  remaining: number;
  cap: number;
  lastTopUpTurn: number | null | undefined;
  /** Post-credit side effect, e.g. mirroring a UK shared pool to its rows. */
  afterCredit?: (remaining: number, now: Date) => Promise<void>;
}

type Resolution =
  { ok: true; pool: ResolvedPool } | { ok: false; status: 403 | 404; error: string };

function sameId(a: ObjectId | null | undefined, b: ObjectId): boolean {
  return !!a && a.toString() === b.toString();
}

async function resolveMinisterialPool(
  db: Db,
  characterId: ObjectId,
  countryId: CountryId,
  positionId: string,
  now: Date
): Promise<Resolution> {
  const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
  if (!member) return { ok: false, status: 404, error: "Cabinet position not found" };
  if (!sameId(member.characterId, characterId)) {
    return { ok: false, status: 403, error: "Only the sitting cabinet member can buy actions" };
  }
  if (usesSharedMinisterialPool(countryId, member)) {
    const pool = await ensureUkSharedPool(db, member.characterId, now);
    const stamp = await db
      .collection<Character>("characters")
      .findOne(
        { _id: member.characterId },
        { projection: { sharedMinisterialActionTopUpTurn: 1 } }
      );
    const holderId = member.characterId;
    return {
      ok: true,
      pool: {
        collection: "characters",
        docId: holderId,
        field: "sharedMinisterialActions",
        topUpField: "sharedMinisterialActionTopUpTurn",
        remaining: pool.remaining,
        cap: MINISTERIAL_ACTION_CAP,
        lastTopUpTurn: stamp?.sharedMinisterialActionTopUpTurn,
        afterCredit: async (remaining, at) => {
          await getCabinetMembersCollection(db).updateMany(
            { countryId: "UK" as never, characterId: holderId },
            { $set: { ministerialActions: remaining, updatedAt: at } }
          );
        },
      },
    };
  }
  const remaining = await resolveMinisterialRemaining(db, countryId, member, now);
  return {
    ok: true,
    pool: {
      collection: "cabinetMembers",
      docId: member._id,
      field: "ministerialActions",
      topUpField: "lastMinisterialActionTopUpTurn",
      remaining,
      cap: MINISTERIAL_ACTION_CAP,
      lastTopUpTurn: member.lastMinisterialActionTopUpTurn,
    },
  };
}

async function resolveVpPool(
  db: Db,
  characterId: ObjectId,
  countryId: CountryId
): Promise<Resolution> {
  const vp = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ countryId, officeType: "vicePresident" });
  if (!vp) return { ok: false, status: 404, error: "No vice-president office found" };
  if (!sameId(vp.characterId, characterId)) {
    return { ok: false, status: 403, error: "Only the sitting vice-president can buy actions" };
  }
  // Legacy VP docs without a pool are backfilled to the cap, as the action route does.
  if (vp.vpActionsRemaining == null) {
    await db
      .collection<ElectedOfficial>("electedOfficials")
      .updateOne({ _id: vp._id }, { $set: initialVpActionFields() });
  }
  return {
    ok: true,
    pool: {
      collection: "electedOfficials",
      docId: vp._id,
      field: "vpActionsRemaining",
      topUpField: "lastVpActionTopUpTurn",
      remaining: vp.vpActionsRemaining ?? VP_ACTION_CAP,
      cap: VP_ACTION_CAP,
      lastTopUpTurn: vp.lastVpActionTopUpTurn,
    },
  };
}

async function resolveJusticePool(
  db: Db,
  characterId: ObjectId,
  countryId: CountryId,
  seatNumber: number
): Promise<Resolution> {
  const seat = await db
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .findOne({ countryId, seatNumber });
  if (!seat) return { ok: false, status: 404, error: "Court seat not found" };
  if (!sameId(seat.justiceCharacterId, characterId)) {
    return {
      ok: false,
      status: 403,
      error: "Only the sitting Justice for this seat can buy actions",
    };
  }
  if (seat.justiceActionsRemaining == null) {
    await db
      .collection<SupremeCourtSeat>("supremeCourtSeats")
      .updateOne({ _id: seat._id }, { $set: initialJusticeActionFields() });
  }
  return {
    ok: true,
    pool: {
      collection: "supremeCourtSeats",
      docId: seat._id,
      field: "justiceActionsRemaining",
      topUpField: "lastJusticeActionTopUpTurn",
      remaining: seat.justiceActionsRemaining ?? JUSTICE_ACTION_CAP,
      cap: JUSTICE_ACTION_CAP,
      lastTopUpTurn: seat.lastJusticeActionTopUpTurn,
    },
  };
}

async function resolveGubernatorialPool(
  db: Db,
  characterId: ObjectId,
  countryId: CountryId,
  rawStateId: string
): Promise<Resolution> {
  const nationalStateId = getNationalStateId(countryId);
  const isNational = rawStateId.toLowerCase() === nationalStateId?.toLowerCase();
  const stateId = isNational ? nationalStateId : rawStateId.toUpperCase();
  const isHolder = isNational
    ? await isSittingLeader(db, countryId, characterId)
    : (await resolveOfficeAccess(db, countryId, stateId, characterId)).viewerIsHolder;
  if (!isHolder) {
    return { ok: false, status: 403, error: "Only the sitting office-holder can buy actions" };
  }
  const office = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .findOne({ countryId, stateId });
  if (!office?._id) return { ok: false, status: 404, error: "Office not found" };
  return {
    ok: true,
    pool: {
      collection: "governorOfficeState",
      docId: office._id,
      field: "gubernatorialActions",
      topUpField: "lastGubernatorialActionTopUpTurn",
      remaining: office.gubernatorialActions ?? GUBERNATORIAL_ACTION_CAP,
      cap: GUBERNATORIAL_ACTION_CAP,
      lastTopUpTurn: office.lastGubernatorialActionTopUpTurn,
    },
  };
}

function resolvePool(db: Db, characterId: ObjectId, target: OfficePoolTarget, now: Date) {
  switch (target.kind) {
    case "ministerial":
      return resolveMinisterialPool(db, characterId, target.countryId, target.positionId, now);
    case "vp":
      return resolveVpPool(db, characterId, target.countryId);
    case "justice":
      return resolveJusticePool(db, characterId, target.countryId, target.seatNumber);
    case "gubernatorial":
      return resolveGubernatorialPool(db, characterId, target.countryId, target.stateId);
  }
}

/**
 * Spend `OFFICE_POOL_TOP_UP_AP_COST` main AP to add one action to an office
 * pool the character holds. Standalone Mongo has no transactions, so the AP
 * debit is a conditional single-document update made first, and the pool
 * credit is a conditional update gated on `pool < cap` and "not already
 * topped up this turn". If the credit loses a race, the AP is refunded.
 */
export async function topUpOfficePool(
  db: Db,
  characterId: ObjectId,
  target: OfficePoolTarget,
  currentTurn: number,
  now: Date = new Date()
): Promise<OfficePoolTopUpResult> {
  const resolved = await resolvePool(db, characterId, target, now);
  if (!resolved.ok) return resolved;
  const { pool } = resolved;

  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: characterId }, { projection: { actions: 1 } });
  const blocked = officePoolTopUpBlock({
    remaining: pool.remaining,
    cap: pool.cap,
    lastTopUpTurn: pool.lastTopUpTurn,
    currentTurn,
    playerActions: character?.actions ?? 0,
  });
  if (blocked) return { ok: false, status: blocked.status, error: blocked.error };

  const charactersCol = db.collection<Character>("characters");
  const debited = await charactersCol.findOneAndUpdate(
    { _id: characterId, actions: { $gte: OFFICE_POOL_TOP_UP_AP_COST } },
    { $inc: { actions: -OFFICE_POOL_TOP_UP_AP_COST }, $set: { updatedAt: now } },
    { returnDocument: "after", projection: { actions: 1 } }
  );
  if (!debited) {
    return { ok: false, status: 409, error: "Your available AP changed. Please try again." };
  }

  const credited = await db.collection(pool.collection).findOneAndUpdate(
    {
      _id: pool.docId,
      [pool.field]: { $lt: pool.cap },
      [pool.topUpField]: { $ne: currentTurn },
    } as never,
    { $inc: { [pool.field]: 1 }, $set: { [pool.topUpField]: currentTurn, updatedAt: now } },
    { returnDocument: "after", projection: { [pool.field]: 1 } }
  );
  const remaining = (credited as Record<string, unknown> | null)?.[pool.field];
  if (typeof remaining !== "number") {
    await charactersCol.updateOne(
      { _id: characterId },
      { $inc: { actions: OFFICE_POOL_TOP_UP_AP_COST }, $set: { updatedAt: now } }
    );
    return {
      ok: false,
      status: 409,
      error: "This action pool filled or was already topped up this turn. Your AP was refunded.",
    };
  }

  await pool.afterCredit?.(remaining, now);
  return {
    ok: true,
    kind: target.kind,
    remaining,
    cap: pool.cap,
    actionsLeft: debited.actions ?? 0,
  };
}
