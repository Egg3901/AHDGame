/**
 * POST /api/whitehouse/cabinet/acting — President appoints an acting cabinet member (no Senate confirmation)
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import { CONGRESS_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCabinetPositionById } from "@/lib/constants";
import { resetCabinetSettingCooldowns } from "@/lib/db/collections/cabinetSettings";
import type { CabinetMember, CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";

const actingSchema = z.object({
  positionId: z
    .string()
    .min(1, "positionId required")
    .refine((id) => !!getCabinetPositionById(id), { message: "Invalid positionId" }),
  characterId: schemas.objectId,
});

// POST /api/whitehouse/cabinet/acting — President appoints an acting cabinet member without Senate confirmation.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request) {
  try {
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

    const db = await getDb();
    const now = new Date();

    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId: "US", officeType: "president", characterId: { $ne: null } });
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

    let appointeeOid: ObjectId;
    try {
      appointeeOid = new ObjectId(characterId);
    } catch {
      return NextResponse.json({ error: "Invalid characterId" }, { status: 400 });
    }

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
    if (appointee.countryId !== "US") {
      return NextResponse.json(
        { error: "Only US politicians can receive US cabinet appointments" },
        { status: 400 }
      );
    }

    // Remove any current member and withdraw any pending nomination for this position
    await Promise.all([
      db.collection<CabinetMember>("cabinetMembers").deleteOne({ countryId: "US", positionId }),
      db
        .collection<CabinetNomination>("cabinetNominations")
        .updateMany(
          { positionId, status: { $in: ["active", "proposed"] } },
          { $set: { status: "withdrawn", updatedAt: now } }
        ),
    ]);

    const member: Omit<CabinetMember, "_id"> = {
      countryId: "US",
      positionId,
      characterId: appointeeOid,
      characterName: appointee.name,
      party: appointee.party,
      appointedByPresidentId: presidentOfficial.characterId,
      acting: true,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await db
      .collection<CabinetMember>("cabinetMembers")
      .insertOne(member as unknown as CabinetMember);

    // Clear the predecessor's setting cooldowns so the acting secretary can change
    // settings immediately (cabinetSettings is keyed by position, not holder).
    await resetCabinetSettingCooldowns(db, "US", positionId);

    const posName = getCabinetPositionById(positionId)?.name ?? positionId;
    if (appointee.userId) {
      await createNotification({
        userId: appointee.userId,
        type: "system",
        title: "Acting Cabinet Appointment",
        message: `You have been appointed Acting ${posName} by the President.`,
        metadata: { positionId, type: "cabinet_acting_appointed" },
      });
    }

    return NextResponse.json({
      success: true,
      message: `${appointee.name} appointed as Acting ${posName}.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
