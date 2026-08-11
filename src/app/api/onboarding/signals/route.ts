import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { loadOnboardingSignals } from "@/lib/onboarding/checklist";

/**
 * GET /api/onboarding/signals — live "has the player done it yet" flags the
 * interactive tutorial coach polls to auto-advance action steps (join a party,
 * cast a vote, run a campaign action, file for a race, invest, take a company,
 * back a union). Reuses the same derivation the onboarding checklist uses so
 * the two can never disagree. Keys here match CoachAdvanceSignal.
 */
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    const db = await getDb();
    const signals = await loadOnboardingSignals(db, character._id);

    return NextResponse.json({
      party: Boolean(character.party) && character.party !== "independent",
      vote: signals.hasVoted,
      campaign: signals.hasCampaignActed,
      candidacy: signals.hasCandidacy,
      invest: signals.hasInvested,
      company: signals.hasCompany,
      union: signals.hasUnion,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
