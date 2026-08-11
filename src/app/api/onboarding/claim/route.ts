import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameState } from "@/lib/gameState";
import { isOnboardingChecklistEnabled } from "@/lib/onboarding/featureFlag";
import { loadOnboardingChecklist } from "@/lib/onboarding/checklist";
import { grantOnboardingReward } from "@/lib/onboarding/reward";

// POST /api/onboarding/claim - Claims the one-time onboarding checklist completion reward.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404, 429
export async function POST() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    const rateLimit = checkRateLimit(`onboarding-claim:${auth.user.userId}`, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const gameState = await getGameState();
    // Fail closed: with the gate off the reward cannot be claimed.
    if (!(await isOnboardingChecklistEnabled(gameState ?? {}))) {
      return NextResponse.json({ error: "Onboarding checklist is not available" }, { status: 404 });
    }

    if (character.onboarding?.rewardGrantedAt !== undefined) {
      return NextResponse.json({ success: true, alreadyClaimed: true, amount: 0 });
    }

    const db = await getDb();
    const checklist = await loadOnboardingChecklist(db, character);
    if (!checklist.allComplete) {
      return NextResponse.json(
        {
          error: `Checklist is not complete (${checklist.completedCount} of ${checklist.total} steps done)`,
        },
        { status: 400 }
      );
    }

    const result = await grantOnboardingReward(db, character, gameState?.currentTurn ?? 0);
    if (!result.granted) {
      // Lost a race with a concurrent claim — the stamp already exists.
      return NextResponse.json({ success: true, alreadyClaimed: true, amount: 0 });
    }

    return NextResponse.json({ success: true, alreadyClaimed: false, amount: result.amount });
  } catch (error) {
    return handleRouteError(error);
  }
}
