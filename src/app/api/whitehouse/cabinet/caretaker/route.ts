/**
 * POST   /api/whitehouse/cabinet/caretaker — head of gov appoints an NPP caretaker minister
 * DELETE /api/whitehouse/cabinet/caretaker?positionId=... — dismiss the caretaker
 *
 * Player-appointed caretaker minister (NPP-autonomy V2.1). Only the country's
 * sitting president (head of government) may appoint or dismiss, and NPP autonomy
 * must be at the comingle tier for this country (`nppAutonomyAtLeast(v2)`).
 * Country-scoped via ?country= (default US). Auth: requireBasicAuth + president.
 * Errors: 400, 401, 403, 404, 429.
 */

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { CONGRESS_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import {
  appointCaretakerMinister,
  dismissCaretakerMinister,
  type CaretakerMinisterError,
} from "@/lib/nppAutonomy/caretakerMinister";
import { getCabinetPositionById } from "@/lib/constants";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import type { Db } from "mongodb";

const appointSchema = z.object({
  positionId: z.string().min(1, "positionId required"),
  nppId: schemas.objectId,
});

/** Resolve the calling user's character if they are the country's president. */
async function requirePresident(
  db: Db,
  countryId: CountryId,
  userId: string
): Promise<{ ok: true; characterId: ObjectId } | { ok: false; response: NextResponse }> {
  const presidentOfficial = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne({ countryId, officeType: "president", characterId: { $ne: null } });
  if (!presidentOfficial?.characterId) {
    return {
      ok: false,
      response: errorResponse(400, "No President in office"),
    };
  }
  const myCharacter = await db
    .collection<Character>("characters")
    .findOne({ userId: new ObjectId(userId) });
  if (!myCharacter || !presidentOfficial.characterId.equals(myCharacter._id)) {
    return {
      ok: false,
      response: errorResponse(403, "Only the President can manage caretaker ministers"),
    };
  }
  return { ok: true, characterId: myCharacter._id };
}

/** Map a caretaker-minister error to an HTTP response. */
function ministerErrorResponse(error: CaretakerMinisterError): NextResponse {
  switch (error) {
    case "invalid-position":
      return errorResponse(400, "Invalid cabinet position.");
    case "head-of-gov-seat":
      return errorResponse(400, "The head-of-government seat cannot be filled by a caretaker.");
    case "npp-not-found":
      return errorResponse(404, "Caretaker not found.");
    case "npp-wrong-country":
      return errorResponse(400, "That caretaker is not from this country.");
    case "npp-retired":
      return errorResponse(400, "That caretaker is retired.");
    case "npp-already-seated":
      return errorResponse(400, "That caretaker already holds a cabinet seat.");
  }
}

async function gate(
  request: Request,
  userId: string
): Promise<
  | { ok: true; db: Db; countryId: CountryId; characterId: ObjectId }
  | { ok: false; response: NextResponse }
> {
  const countryId = resolvePresidentialCountry(request);
  if (!countryId) {
    return {
      ok: false,
      response: errorResponse(400, "Unknown country"),
    };
  }
  const db = await getDb();
  const pres = await requirePresident(db, countryId, userId);
  if (!pres.ok) return pres;
  if (!(await nppAutonomyAtLeast(db, countryId, "v2"))) {
    return {
      ok: false,
      response: errorResponse(403, "Caretaker ministers are not enabled in this country."),
    };
  }
  return { ok: true, db, countryId, characterId: pres.characterId };
}

export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(
      `cabinet:${auth.user.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const gated = await gate(request, auth.user.userId);
    if (!gated.ok) return gated.response;

    const result = await appointCaretakerMinister(gated.db, {
      countryId: gated.countryId,
      positionId: parsed.data.positionId,
      nppId: new ObjectId(parsed.data.nppId),
      appointingCharacterId: gated.characterId,
      now: new Date(),
    });
    if (!result.ok) return ministerErrorResponse(result.error!);

    const posName = getCabinetPositionById(parsed.data.positionId)?.name ?? parsed.data.positionId;
    return NextResponse.json({
      success: true,
      message: `${result.nppName} appointed as caretaker ${posName}.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(
      `cabinet:${auth.user.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const positionId = new URL(request.url).searchParams.get("positionId");
    if (!positionId) {
      return errorResponse(400, "positionId required");
    }

    const gated = await gate(request, auth.user.userId);
    if (!gated.ok) return gated.response;

    const result = await dismissCaretakerMinister(gated.db, {
      countryId: gated.countryId,
      positionId,
    });
    if (!result.ok) {
      return errorResponse(400, "That seat is not held by a caretaker minister.");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
