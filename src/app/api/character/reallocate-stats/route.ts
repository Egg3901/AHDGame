import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Character, User } from "@/lib/db/types";
import { validateStatAllocation } from "@/lib/stats/validateStatAllocation";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";

const reallocateStatsSchema = z.object({
  stats: z.record(z.string(), z.number()),
});

/** Resolve the requesting user's active character. */
async function loadActiveCharacter(userId: string) {
  const db = await getDb();
  const userDoc = await db
    .collection<User>("users")
    .findOne({ _id: new ObjectId(userId) }, { projection: { activeCharacterId: 1 } });
  const query = userDoc?.activeCharacterId
    ? { _id: userDoc.activeCharacterId, userId: new ObjectId(userId) }
    : { userId: new ObjectId(userId) };
  const character = await db.collection<Character>("characters").findOne(query);
  return { db, character };
}

// POST /api/character/reallocate-stats — Spends the character's single free stat
// reallocation. Full reset: rewrites the 28-point spread, clears earned growth
// (statXp), and resets the Debate decay anchor. One per character, ever.
// Auth: requireHumanSession. Errors: 400, 401, 403, 404, 409, 429.
export async function POST(request: Request) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isRpgStatsEnabled())) {
      return NextResponse.json(
        { error: "The stat system is not currently enabled." },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, reallocateStatsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const validation = validateStatAllocation(parsed.data.stats);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { db, character } = await loadActiveCharacter(auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    if (!character.statsAllocated) {
      return NextResponse.json(
        { error: "Allocate your stats before reallocating." },
        { status: 409 }
      );
    }
    if (character.statsReallocationUsed) {
      return NextResponse.json(
        { error: "You have already used your free stat reallocation." },
        { status: 409 }
      );
    }

    // Atomic guard: only spend the reallocation if it is still unused (prevents
    // a double-submit from resetting earned growth twice).
    const result = await db.collection<Character>("characters").updateOne(
      { _id: character._id, statsAllocated: true, statsReallocationUsed: { $ne: true } },
      {
        $set: {
          stats: validation.stats,
          statsReallocationUsed: true,
          statXp: {},
          debateDecayAnchor: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: "You have already used your free stat reallocation." },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, stats: validation.stats });
  } catch (error) {
    return handleRouteError(error);
  }
}
