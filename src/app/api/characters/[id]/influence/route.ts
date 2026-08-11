import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { characterInfluenceActionSchema } from "@/lib/api/schemas/influence";
import { getSimpleInfluenceInfo, executeSimpleInfluence } from "@/lib/influence/simpleInfluence";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/characters/[id]/influence — Returns influence info and options for the authenticated user against a target character
// Auth: requireBasicAuth
// Errors: 400, 401
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const { id: targetId } = await params;
    const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);

    const myCharacter = await getCharacterByUserId(db, user.userId);

    if (!myCharacter) {
      return NextResponse.json(
        { error: "You need a character to influence others" },
        { status: 400 }
      );
    }

    const { info, error } = await getSimpleInfluenceInfo(
      db,
      myCharacter,
      targetId,
      "character",
      forexEnabled
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(info);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/characters/[id]/influence — Executes an influence action against a target character
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id: targetId } = await params;
    const parsed = await parseJsonBody(request, characterInfluenceActionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action } = parsed.data;

    const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);

    const myCharacter = await getCharacterByUserId(db, user.userId);

    if (!myCharacter) {
      return NextResponse.json(
        { error: "You need a character to influence others" },
        { status: 400 }
      );
    }

    const { result, error } = await executeSimpleInfluence(
      db,
      user.userId,
      myCharacter,
      targetId,
      "character",
      action,
      forexEnabled
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    try {
      const { checkInfluenceAchievements } = await import("@/lib/achievements/triggers");
      await checkInfluenceAchievements(new ObjectId(user.userId), myCharacter._id);
    } catch (e) {
      console.error("Achievement check failed:", e);
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
