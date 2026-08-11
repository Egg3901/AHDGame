/**
 * POST /api/whitehouse/cabinet/fire — President fires a cabinet member
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import type { CabinetMember, ElectedOfficial, Character } from "@/lib/db/types";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";

const fireSchema = z.object({
  // positionId validated against the resolved country's positions in the handler.
  positionId: z.string().min(1, "positionId required"),
});

// POST /api/whitehouse/cabinet/fire — President fires a cabinet member from their position and notifies them.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, fireSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { positionId } = parsed.data;

    const countryId = resolvePresidentialCountry(request);
    if (!countryId) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }
    const positionDef = getCabinetPositions(countryId).find((p) => p.id === positionId);
    if (!positionDef) {
      return NextResponse.json({ error: "Invalid positionId" }, { status: 400 });
    }

    const db = await getDb();

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
        { error: "Only the President can fire cabinet members" },
        { status: 403 }
      );
    }

    const member = await db.collection<CabinetMember>("cabinetMembers").findOne({
      countryId,
      positionId,
    });
    if (!member) {
      return NextResponse.json({ error: "No cabinet member in that position" }, { status: 404 });
    }

    await db.collection<CabinetMember>("cabinetMembers").deleteOne({ _id: member._id });

    const posName = positionDef.name;

    const firedChar = await db
      .collection<Character>("characters")
      .findOne({ _id: member.characterId }, { projection: { userId: 1 } });
    if (firedChar?.userId) {
      await createNotification({
        userId: firedChar.userId,
        type: "system",
        title: "Removed from Cabinet",
        message: `You were removed from ${posName} by the President.`,
        metadata: { positionId, type: "cabinet_fired" },
      });
    }

    return NextResponse.json({
      success: true,
      message: `${member.characterName} removed from ${posName}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
