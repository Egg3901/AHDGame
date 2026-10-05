import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { executeActionSchema } from "@/lib/api/schemas/actions";
import { ACTIONS, BATCHABLE_ACTION_TYPES } from "@/lib/actions";
import { executeCharacterAction } from "@/lib/actions/commands/executeAction";
import type { ActionType, Character, User } from "@/lib/db/types";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

// POST /api/actions/execute — Executes a political action (optionally in batch) and applies its effects to the character
// Auth: requireHumanSession (bot tokens rejected)
// Errors: 400, 401, 403, 404, 429
//
// Request concerns (auth, rate-limit, batch/convert validation, character
// resolution, response shaping) live here; the action's effects + persistence
// are owned by the shared `executeCharacterAction` core so the autonomous NPP
// brain drives the same implementation.
export async function POST(request: Request) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, executeActionSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { actionType, targetState, convertAmount, count: rawCount } = parsed.data;
    const count = rawCount ?? 1;

    const action = ACTIONS[actionType];
    if (!action) {
      return errorResponse(400, "Invalid action type");
    }

    if (count > 1) {
      if (!BATCHABLE_ACTION_TYPES.includes(actionType as ActionType)) {
        return errorResponse(400, "Batch execution is not available for this action.");
      }
      if (actionType === "convertCash") {
        return errorResponse(400, "Batch execution is not available for this action.");
      }
    }

    if (count > 1 && convertAmount != null) {
      return errorResponse(400, "Invalid request.");
    }

    if (action.requiresState && !targetState) {
      return errorResponse(400, "This action requires a target state");
    }

    const db = await getDb();

    // Resolve active character (admin accounts may have multiple characters)
    const userDoc = await db.collection<User>("users").findOne({ _id: new ObjectId(user.userId) });
    const characterQuery = userDoc?.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(user.userId) }
      : { userId: new ObjectId(user.userId) };
    const character = await db.collection<Character>("characters").findOne(characterQuery);

    if (!character) {
      return errorResponse(404, "Character not found");
    }

    const result = await executeCharacterAction(db, {
      character,
      characterQuery,
      actionType,
      targetState,
      convertAmount,
      count,
      actor: { userId: new ObjectId(user.userId), username: userDoc?.username },
    });

    if (!result.ok) {
      return errorResponse(result.status, result.error);
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      character: result.updatedCharacter,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
