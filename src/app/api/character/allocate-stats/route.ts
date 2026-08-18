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
import { suggestStatBuild, type SuggestBuildInput } from "@/lib/stats/suggestedBuild";

const allocateStatsSchema = z.object({
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

/** Derive a suggested build from cheap character signals + CEO corp count. */
async function buildSuggestion(
  db: Awaited<ReturnType<typeof getDb>>,
  character: Character
): Promise<ReturnType<typeof suggestStatBuild>> {
  const corpsOwned = await db.collection("corporations").countDocuments({
    ceoId: character._id,
    $or: [{ ceoType: "character" }, { ceoType: { $exists: false } }],
  });
  const input: SuggestBuildInput = {
    corpsOwned,
    isCeo: corpsOwned > 0,
    donorBaseLevel: character.donorBaseLevel ?? 0,
    campaignFunds: character.currencyBalances?.campaign ?? character.funds ?? 0,
    favorability: character.favorability ?? 0,
    politicalInfluence: character.politicalInfluence ?? 0,
    hasOffice: character.currentOffice != null,
    careerLength: character.careerHistory?.length ?? 0,
  };
  return suggestStatBuild(input);
}

// GET /api/character/allocate-stats — Returns a suggested 28-point build for the
// active character (used to pre-fill the grandfather allocation modal).
// Auth: requireHumanSession. Errors: 401, 403, 404, 409.
export async function GET(request: Request) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    if (!(await isRpgStatsEnabled())) {
      return NextResponse.json(
        { error: "The stat system is not currently enabled." },
        { status: 403 }
      );
    }

    const { db, character } = await loadActiveCharacter(auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    if (character.statsAllocated) {
      return NextResponse.json({ error: "Stats already allocated." }, { status: 409 });
    }

    const suggestion = await buildSuggestion(db, character);
    return NextResponse.json({ suggestion });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/character/allocate-stats — Commits a one-time 28-point stat allocation
// for a grandfathered character.
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

    const parsed = await parseJsonBody(request, allocateStatsSchema);
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
    if (character.statsAllocated) {
      return NextResponse.json({ error: "Stats already allocated." }, { status: 409 });
    }

    // Atomic guard: only allocate if still unallocated (prevents double-submit).
    const result = await db.collection<Character>("characters").updateOne(
      { _id: character._id, statsAllocated: { $ne: true } },
      {
        $set: {
          stats: validation.stats,
          statsAllocated: true,
          statXp: {},
          debateDecayAnchor: new Date(),
          updatedAt: new Date(),
        },
      }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Stats already allocated." }, { status: 409 });
    }

    return NextResponse.json({ success: true, stats: validation.stats });
  } catch (error) {
    return handleRouteError(error);
  }
}
