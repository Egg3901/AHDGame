import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, isDuplicateKeyError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import { CONGRESS_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear, getManuallyEnabledSeats } from "@/lib/cabinet/liveGameYear";
import { getGameState } from "@/lib/gameState";
import { type CountryId } from "@/lib/constants/countries";
import { actingAppointmentsEnabled } from "./actingEligibility";
import { ACTING_TENURE_TURNS } from "./actingScope";
import { initialMinisterialActionFields } from "./ministerialActionPool";
import {
  hasUnspentActingCharge,
  refundActingCharge,
  spendActingCharge,
  type ActingChargeKey,
} from "@/lib/db/collections/actingAppointmentCharges";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import type { CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";

const actingSchema = z.object({
  // Validated against the country's own roster below, not here: a bare id
  // lookup is global and would accept another country's seat.
  positionId: z.string().min(1, "positionId required"),
  characterId: schemas.objectId,
});

/**
 * Install an acting cabinet member: a caretaker the executive seats directly to
 * keep a department running while confirmation is pending.
 *
 * Deliberately NOT a way around the legislature. The seat must be vacant, the
 * President gets one per seat per presidency, a nominee the Senate has already
 * rejected cannot be installed anyway, and the appointment lapses after
 * ACTING_TENURE_TURNS. A pending nomination is left running, and the seat's
 * policy cooldowns are NOT reset: cooldowns belong to the seat, not the holder,
 * or swapping caretakers would reset department policy at will.
 */
export async function appointActingCabinetMember(
  request: Request,
  countryId: CountryId
): Promise<NextResponse> {
  try {
    if (!actingAppointmentsEnabled(countryId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const limit = checkRateLimit(
      `cabinet:${authUser.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, actingSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { positionId, characterId } = parsed.data;

    // Country-scoped seat lookup, mirroring the nomination route. A global
    // `getCabinetPositionById` would accept a seat belonging to another
    // country's cabinet.
    const positionDef = getCabinetPositions(countryId).find((p) => p.id === positionId);
    if (!positionDef) {
      return NextResponse.json({ error: "Invalid positionId" }, { status: 400 });
    }

    const db = await getDb();
    const now = new Date();

    // Era gating, same rule the nomination route enforces: a seat outside its
    // yearEnabled/yearRetired range does not exist yet and cannot be filled,
    // by confirmation or by an acting appointment.
    if (!isSeatActive(positionDef, await getLiveGameYear(db), await getManuallyEnabledSeats(db))) {
      return NextResponse.json(
        { error: "This cabinet position does not exist in the current era" },
        { status: 400 }
      );
    }

    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "president", characterId: { $ne: null } });
    if (!presidentOfficial?.characterId) {
      return NextResponse.json({ error: "No President in office" }, { status: 400 });
    }

    const myCharacter = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!myCharacter || !presidentOfficial.characterId.equals(myCharacter._id)) {
      return NextResponse.json(
        { error: "Only the President can make acting appointments" },
        { status: 403 }
      );
    }

    const appointeeOid = new ObjectId(characterId);
    const appointee = await db.collection<Character>("characters").findOne({ _id: appointeeOid });
    if (!appointee) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    if (!appointee.userId) {
      return NextResponse.json(
        { error: "Only player characters can receive acting appointments" },
        { status: 400 }
      );
    }
    if (appointee.countryId !== countryId) {
      return NextResponse.json(
        { error: "Only politicians of this country can receive its cabinet appointments" },
        { status: 400 }
      );
    }

    const members = getCabinetMembersCollection(db);

    // Vacancy only. Without this an acting appointment could evict a confirmed
    // secretary, which would make confirmation optional.
    const sitting = await members.findOne({ countryId, positionId });
    if (sitting) {
      return NextResponse.json(
        { error: "This seat is already filled. Dismiss the current holder first." },
        { status: 409 }
      );
    }

    const chargeKey: ActingChargeKey = {
      countryId,
      positionId,
      presidentCharacterId: presidentOfficial.characterId,
      presidencyStartedAt: presidentOfficial.electedAt ?? null,
    };
    if (!(await hasUnspentActingCharge(db, chargeKey))) {
      return NextResponse.json(
        {
          error:
            "You have already used your acting appointment for this office. It can only be filled by confirmation now.",
        },
        { status: 409 }
      );
    }

    // A nominee the Senate turned down cannot be installed anyway.
    const rejected = await db.collection<CabinetNomination>("cabinetNominations").findOne({
      countryId,
      positionId,
      nomineeCharacterId: appointeeOid,
      status: "rejected",
    });
    if (rejected) {
      return NextResponse.json(
        { error: "The Senate rejected this nominee for this office." },
        { status: 409 }
      );
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    // Charge first, seat second. The ledger's unique index is the real lock:
    // the `hasUnspentActingCharge` check above can be raced by a double submit,
    // and a duplicate key here means the charge was already spent. Seating
    // first would let a losing race keep the seat but skip the charge, which is
    // exactly the unlimited-appointments hole this whole change closes. The
    // reverse failure (charge spent, seat not filled) costs one appointment and
    // is recoverable by confirmation, so it is the safer way to fail.
    try {
      await spendActingCharge(db, chargeKey, appointeeOid, currentTurn);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return NextResponse.json(
          {
            error:
              "You have already used your acting appointment for this office. It can only be filled by confirmation now.",
          },
          { status: 409 }
        );
      }
      throw error;
    }

    try {
      await members.insertOne({
        countryId,
        positionId,
        characterId: appointeeOid,
        characterName: appointee.name,
        party: appointee.party,
        appointedByCharacterId: presidentOfficial.characterId,
        appointedAt: now,
        acting: true,
        actingSinceTurn: currentTurn,
        actingExpiresOnTurn: currentTurn + ACTING_TENURE_TURNS,
        ...initialMinisterialActionFields(now),
        createdAt: now,
        updatedAt: now,
      } as never);
    } catch (error) {
      // Seating failed after the charge was spent, so give it back: the
      // President never got the appointment they paid for. Reachable when a
      // concurrent request wins the seat between the vacancy check and here,
      // which the seat's own unique index rejects.
      await refundActingCharge(db, chargeKey).catch(() => undefined);
      // A duplicate key IS that lost race (seat filled, or the appointee was
      // just seated elsewhere): a player-visible 409, not a server fault.
      if (isDuplicateKeyError(error)) {
        return NextResponse.json(
          { error: "That seat or appointee was just claimed by another appointment." },
          { status: 409 }
        );
      }
      throw error;
    }

    // From the country's own roster, resolved above, rather than the global
    // lookup: two countries may share a position id with different names.
    const posName = positionDef.name;
    await createNotification({
      userId: appointee.userId,
      type: "system",
      title: "Acting Cabinet Appointment",
      message: `You have been appointed Acting ${posName} by the President. This appointment lasts ${ACTING_TENURE_TURNS} turns unless the Senate confirms you.`,
      metadata: { positionId, type: "cabinet_acting_appointed" },
    });

    return NextResponse.json({
      success: true,
      message: `${appointee.name} appointed as Acting ${posName}.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
