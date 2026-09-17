import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { handleRouteError, badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { getUkRecallPetitionsCollection } from "@/lib/db/collections/ukByElection";
import { addRecallSignature } from "@/lib/uk/elections/recallPetitionShell";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { RECALL_SIGNATURES_REQUIRED } from "@/lib/uk/elections/commonsRecallRules";

const NO_STORE = { "Cache-Control": "no-store, no-transform" };

const signSchema = z.object({ petitionId: z.string().min(1).max(64) }).strict();

// POST /api/uk/commons/recall/sign — sign an open recall petition. One
// signature per character; re-signing is a no-op success so retries converge.
// Only UK characters may sign. Auth: requireAuthWithCharacter.
// Errors: 400, 401, 403, 404, 409, 429.
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, signSchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), {
        status: parsed.status,
        headers: NO_STORE,
      });
    }
    if (!ObjectId.isValid(parsed.data.petitionId)) {
      return NextResponse.json(badRequest("Invalid petition ID").toJson(), {
        status: 400,
        headers: NO_STORE,
      });
    }
    if (auth.user.character.countryId !== "UK") {
      return NextResponse.json(forbidden("Only UK characters may sign a Commons recall").toJson(), {
        status: 403,
        headers: NO_STORE,
      });
    }

    const db = await getDb();
    const petition = await getUkRecallPetitionsCollection(db).findOne({
      _id: new ObjectId(parsed.data.petitionId),
    });
    if (!petition) {
      return NextResponse.json(notFound("Recall petition not found").toJson(), {
        status: 404,
        headers: NO_STORE,
      });
    }
    if (petition.status !== "open") {
      return NextResponse.json(conflict("That petition is not collecting signatures").toJson(), {
        status: 409,
        headers: NO_STORE,
      });
    }

    const currentTurn = await getCurrentTurn(db);
    const result = await addRecallSignature(
      db,
      petition._id,
      { _id: auth.user.character._id, name: auth.user.character.name },
      currentTurn,
      new Date()
    );
    return NextResponse.json(
      {
        success: true,
        added: result.added,
        signatures: result.signatures,
        signaturesRequired: RECALL_SIGNATURES_REQUIRED,
        message: result.added ? "Signature recorded." : "You have already signed this petition.",
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
