/**
 * POST /api/whitehouse/cabinet/nominations/[id]/withdraw — President withdraws nomination
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseObjectId } from "@/lib/utils/objectId";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { createNotification } from "@/lib/notifications";
import { getCabinetPositionById } from "@/lib/constants";
import type { CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";

// POST /api/whitehouse/cabinet/nominations/[id]/withdraw — President withdraws an active cabinet nomination and notifies the nominee.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const nominationOid = parseObjectId(id);
    if (!nominationOid) {
      return NextResponse.json({ error: "Invalid nomination ID" }, { status: 400 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const now = new Date();

    const nomination = await db.collection<CabinetNomination>("cabinetNominations").findOne({
      _id: nominationOid,
      status: { $in: ["active", "proposed"] },
    });
    if (!nomination) {
      return NextResponse.json(
        { error: "Nomination not found or already resolved" },
        { status: 404 }
      );
    }

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
        { error: "Only the President can withdraw nominations" },
        { status: 403 }
      );
    }

    await db
      .collection<CabinetNomination>("cabinetNominations")
      .updateOne({ _id: nominationOid }, { $set: { status: "withdrawn", updatedAt: now } });

    const posName = getCabinetPositionById(nomination.positionId)?.name ?? nomination.positionId;
    const nomineeChar = await db
      .collection<Character>("characters")
      .findOne({ _id: nomination.nomineeCharacterId }, { projection: { userId: 1 } });
    if (nomineeChar?.userId) {
      await createNotification({
        userId: nomineeChar.userId,
        type: "system",
        title: "Nomination Withdrawn",
        message: `Your nomination for ${posName} was withdrawn by the President.`,
        metadata: { nominationId: nominationOid.toString(), type: "cabinet_nomination_withdrawn" },
      });
    }

    return NextResponse.json({
      success: true,
      message: "Nomination withdrawn",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
