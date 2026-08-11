/**
 * POST /api/whitehouse/scotus/nominate — President nominates a Justice for a vacant seat.
 *
 * Mirrors /api/whitehouse/cabinet/nominations (auth, president check, 24h
 * window) but accepts either an existing player character OR a generated NPP
 * "legal scholar" — no eligibility restriction on either path (#3598).
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
import type { ElectedOfficial, Character } from "@/lib/db/types";
import { createJusticeNomination } from "@/lib/scotus/nominateJustice";

const nominateSchema = z.object({
  seatNumber: z.number().int().min(1).max(9),
  nomineeCharacterId: schemas.objectId.optional(),
  nppLegalScholarParty: z.string().min(1).optional(),
});

// POST /api/whitehouse/scotus/nominate — President nominates a player character or a generated NPP legal scholar for a vacant Court seat.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const limit = checkRateLimit(
      `scotus:${authUser.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, nominateSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { seatNumber, nomineeCharacterId, nppLegalScholarParty } = parsed.data;

    if (!nomineeCharacterId && !nppLegalScholarParty) {
      return NextResponse.json(
        { error: "Must supply either nomineeCharacterId or nppLegalScholarParty" },
        { status: 400 }
      );
    }

    const db = await getDb();

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
        { error: "Only the President can nominate a Justice" },
        { status: 403 }
      );
    }

    const result = await createJusticeNomination(db, {
      countryId: "US",
      seatNumber,
      proposedByPresidentId: presidentOfficial.characterId,
      proposedByPresidentName: myCharacter.name,
      ...(nomineeCharacterId
        ? { nomineeCharacterId: new ObjectId(nomineeCharacterId) }
        : { generateNppLegalScholar: { party: nppLegalScholarParty! } }),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const senators = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: "US",
        officeType: "senate",
        characterId: { $ne: null },
        isNPP: { $ne: true },
      })
      .toArray();
    const senatorCharIds = senators.map((s) => s.characterId!).filter(Boolean);
    const senatorChars = senatorCharIds.length
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: senatorCharIds } }, { projection: { _id: 1, userId: 1 } })
          .toArray()
      : [];
    for (const c of senatorChars) {
      await createNotification({
        userId: c.userId,
        type: "system",
        title: "Justice Nomination",
        message: `President has nominated ${result.nomineeName} for Supreme Court seat #${seatNumber}. Senate vote is open.`,
        metadata: { nominationId: result.nominationId.toString(), type: "scotus_nomination" },
      });
    }

    return NextResponse.json({
      success: true,
      nominationId: result.nominationId.toString(),
      message: `Nominated ${result.nomineeName} for Supreme Court seat #${seatNumber}. Senate vote opens for 24 hours.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
