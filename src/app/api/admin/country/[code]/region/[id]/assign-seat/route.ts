/**
 * POST /api/admin/country/[code]/region/[id]/assign-seat
 * Admin: assign a politician to a seat in a region.
 * Moved from /api/admin/state/[id]/assign-seat.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { adminAssignSeatSchema } from "@/lib/api/schemas/admin";
import {
  COUNTRY_CONFIGS,
  getRegionAppointableSeats,
  type CountryId,
  type RegionAppointableSeatSpec,
} from "@/lib/constants/countries";
import { subNationalChamberSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import type { ElectedOfficial, Character, NPP, State } from "@/lib/db/types";
import { handleRouteError } from "@/lib/api/errors";
import type { Db } from "mongodb";

/** Seat total for a multi-seat group, read from the resolved State field. */
function totalForSpec(
  spec: RegionAppointableSeatSpec,
  state: State,
  countryId: CountryId,
  preset: string | undefined
): number {
  // The sub-national chamber is country-resolved: for CN it is the elected
  // People's Congress (not `stateSenateSeats`, which is the appointed CPPCC).
  if (spec.kind === "subNationalChamber") return subNationalChamberSeats(countryId, state, preset);
  if (spec.totalsByRegion) return spec.totalsByRegion[state._id] ?? 0;
  if (spec.totalField === "houseDistricts") return state.houseDistricts ?? 0;
  if (spec.totalField === "stateSenateSeats") return state.stateSenateSeats ?? 0;
  return 0;
}

/**
 * After assigning seats to an existing official via $inc, clean up vacant
 * records in that state/officeType. Vacant records (characterId=null,
 * nppId absent) accumulate when officials are removed but their seats
 * are reassigned to someone else — the vacant record's seatsHeld becomes
 * stale. This deletes vacant records that no longer represent real vacancies.
 */
async function cleanupVacantRecords(db: Db, stateId: string, officeType: string): Promise<void> {
  await db.collection("electedOfficials").deleteMany({
    state: stateId,
    officeType,
    characterId: null,
    nppId: { $exists: false },
  });
}

/** Stamp the assigned office onto the actor's `currentOffice` (character or NPP). */
async function setCurrentOffice(
  db: Db,
  actor: { isNPP: boolean; nppId: ObjectId | null; characterId: ObjectId | null },
  currentOffice: { type: string; state: string; seatsHeld?: number }
): Promise<void> {
  if (actor.isNPP && actor.nppId) {
    await db.collection<NPP>("npps").updateOne({ _id: actor.nppId }, { $set: { currentOffice } });
  } else if (actor.characterId) {
    await db
      .collection<Character>("characters")
      .updateOne({ _id: actor.characterId }, { $set: { currentOffice } });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const stateId = id;

    const parsed = await parseJsonBody(request, adminAssignSeatSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { seatType, senateClass, entityId, entityType, seatsToAssign } = parsed.data;

    const db = await getDb();
    const now = new Date();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Get entity details
    let characterName: string;
    let party: string;
    let characterId: ObjectId | null = null;
    let nppId: ObjectId | null = null;
    let isNPP = false;

    const entityOid = parseObjectId(entityId);
    if (!entityOid) {
      return NextResponse.json({ error: "Invalid entity ID" }, { status: 400 });
    }

    if (entityType === "player") {
      const character = await db.collection<Character>("characters").findOne({
        _id: entityOid,
      });
      if (!character) {
        return NextResponse.json({ error: "Player not found" }, { status: 404 });
      }
      characterName = character.name;
      party = character.party;
      characterId = character._id;
    } else {
      const npp = await db.collection<NPP>("npps").findOne({
        _id: entityOid,
      });
      if (!npp) {
        return NextResponse.json({ error: "NPP not found" }, { status: 404 });
      }
      characterName = npp.name;
      party = npp.party;
      nppId = npp._id;
      isNPP = true;
    }

    // Resolve the requested seat against the country's region-appointable
    // offices — `seatType` IS the officeType key (governor / senate / house /
    // npcDelegate / peoplesCongress / …). No hardcoded US offices.
    const spec = getRegionAppointableSeats(countryId).find((s) => s.officeType === seatType);
    if (!spec) {
      return NextResponse.json(
        { error: `${seatType} is not an appointable seat in ${state.name}` },
        { status: 400 }
      );
    }

    const officeType = spec.officeType;
    // Helpers for the per-actor identity match on existing-office lookups.
    const actorMatch = isNPP ? { nppId: nppId! } : { characterId: characterId! };

    // ── Single-seat upper chamber (US Senate): one holder per class ──────────
    if (spec.kind === "classedUpper") {
      const existingHolder = await db.collection("electedOfficials").findOne({
        state: stateId,
        officeType,
        senateClass,
        $or: [{ characterId: { $ne: null } }, { nppId: { $ne: null } }],
      });
      if (existingHolder) {
        return NextResponse.json(
          { error: `This ${spec.label} seat is already filled` },
          { status: 400 }
        );
      }
      const alreadyHolds = await db
        .collection("electedOfficials")
        .findOne({ officeType, ...actorMatch });
      if (alreadyHolds) {
        return NextResponse.json(
          { error: `This politician already holds a ${spec.label} seat` },
          { status: 400 }
        );
      }

      await db.collection("electedOfficials").updateOne(
        { state: stateId, officeType, senateClass },
        {
          $set: {
            characterId: characterId ?? null,
            nppId: nppId ?? null,
            isNPP,
            characterName,
            party,
            electedAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            state: stateId,
            officeType,
            senateClass,
            seatsHeld: 1,
            countryId,
            createdAt: now,
          },
        },
        { upsert: true }
      );
      await setCurrentOffice(
        db,
        { isNPP, nppId, characterId },
        { type: officeType, state: stateId }
      );

      return NextResponse.json({
        success: true,
        message: `${characterName} assigned as ${spec.label} (Class ${senateClass}) for ${state.name}`,
      });
    }

    // ── Single-seat regional executive (governor / minister-president) ───────
    if (spec.kind === "executive") {
      const existingHolder = await db.collection("electedOfficials").findOne({
        state: stateId,
        officeType,
        $or: [{ characterId: { $ne: null } }, { nppId: { $ne: null } }],
      });
      if (existingHolder) {
        return NextResponse.json(
          { error: `${spec.label} seat is already filled` },
          { status: 400 }
        );
      }
      const alreadyHolds = await db
        .collection("electedOfficials")
        .findOne({ officeType, ...actorMatch });
      if (alreadyHolds) {
        return NextResponse.json(
          { error: `This politician already holds a ${spec.label} seat` },
          { status: 400 }
        );
      }

      await db.collection("electedOfficials").updateOne(
        { state: stateId, officeType },
        {
          $set: {
            characterId: characterId ?? null,
            nppId: nppId ?? null,
            isNPP,
            characterName,
            party,
            electedAt: now,
            updatedAt: now,
          },
          $setOnInsert: { state: stateId, officeType, seatsHeld: 1, countryId, createdAt: now },
        },
        { upsert: true }
      );
      await setCurrentOffice(
        db,
        { isNPP, nppId, characterId },
        { type: officeType, state: stateId }
      );

      return NextResponse.json({
        success: true,
        message: `${characterName} assigned as ${spec.label} of ${state.name}`,
      });
    }

    // ── Multi-seat chamber (federal lower or sub-national legislature) ───────
    const totalSeats = totalForSpec(spec, state, countryId, await getGameStatePreset(db));
    if (totalSeats === 0) {
      return NextResponse.json(
        { error: `${state.name} has no ${spec.label} seats` },
        { status: 400 }
      );
    }

    const filledOfficials = (await db
      .collection("electedOfficials")
      .find({
        state: stateId,
        officeType,
        $or: [{ characterId: { $ne: null } }, { nppId: { $ne: null } }],
      })
      .toArray()) as ElectedOfficial[];
    const filledSeats = filledOfficials.reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0);
    const vacantSeats = totalSeats - filledSeats;

    if (seatsToAssign > vacantSeats) {
      return NextResponse.json(
        { error: `Only ${vacantSeats} vacant ${spec.label} seat(s) available` },
        { status: 400 }
      );
    }

    const existingOffice = (await db
      .collection("electedOfficials")
      .findOne({ state: stateId, officeType, ...actorMatch })) as ElectedOfficial | null;

    if (existingOffice) {
      await db
        .collection("electedOfficials")
        .updateOne(
          { _id: existingOffice._id },
          { $inc: { seatsHeld: seatsToAssign }, $set: { updatedAt: now } }
        );
      const newSeatsHeld = (existingOffice.seatsHeld ?? 1) + seatsToAssign;
      await setCurrentOffice(
        db,
        { isNPP, nppId, characterId },
        { type: officeType, state: stateId, seatsHeld: newSeatsHeld }
      );
      await cleanupVacantRecords(db, stateId, officeType);

      return NextResponse.json({
        success: true,
        message: `${characterName} assigned ${seatsToAssign} additional ${spec.label} seat(s) in ${state.name} (total: ${newSeatsHeld})`,
      });
    }

    await db.collection("electedOfficials").insertOne({
      _id: new ObjectId(),
      state: stateId,
      officeType,
      isAppointment: false,
      seatsHeld: seatsToAssign,
      characterId: characterId ?? null,
      nppId: nppId ?? null,
      isNPP,
      characterName,
      party,
      countryId,
      electedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await setCurrentOffice(
      db,
      { isNPP, nppId, characterId },
      { type: officeType, state: stateId, seatsHeld: seatsToAssign }
    );

    return NextResponse.json({
      success: true,
      message: `${characterName} assigned ${seatsToAssign} ${spec.label} seat(s) in ${state.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
