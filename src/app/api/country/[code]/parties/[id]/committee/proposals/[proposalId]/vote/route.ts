import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { castProposalVoteSchema } from "@/lib/api/schemas/parties";
import { castVote, getEligibleVoterSet } from "@/lib/parties/proposals";
import type { CommitteeProposal } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string; proposalId: string }>;
}

// POST /api/country/[code]/parties/[id]/committee/proposals/[proposalId]/vote
// Auth: requireAuthWithCharacter
// Side is inferred from the route party [id]: proposing or target
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId, proposalId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return errorResponse(403, "Account is banned");
    }
    const { user } = authResult;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return errorResponse(404, "Party not found");

    let proposalObjectId: ObjectId;
    try {
      proposalObjectId = new ObjectId(proposalId);
    } catch {
      return errorResponse(400, "Invalid proposal ID");
    }

    const proposal = await db
      .collection<CommitteeProposal>("committeeProposals")
      .findOne({ _id: proposalObjectId });
    if (!proposal) return errorResponse(404, "Proposal not found");
    if (proposal.status !== "open") {
      return errorResponse(400, "This proposal is no longer open");
    }

    // Determine which side the voter is on based on the route party [id]
    const partyObjectIdStr = party._id.toString();
    const proposingPartyStr = proposal.partyId.toString();
    const targetPartyStr = proposal.merge?.targetPartyId?.toString();

    let side: "proposing" | "target";

    if (partyObjectIdStr === proposingPartyStr) {
      side = "proposing";
    } else if (proposal.type === "merge" && partyObjectIdStr === targetPartyStr) {
      side = "target";
    } else {
      return errorResponse(403, "Your party is not party to this proposal");
    }

    const characterId = user.character._id;
    const eligibleVoterSet = getEligibleVoterSet(party);
    if (!eligibleVoterSet.has(characterId.toString())) {
      return errorResponse(
        403,
        "Only committee members and national leadership may vote on proposals"
      );
    }

    // removeOfficeHolder: the target character cannot vote on their own
    // removal (procedural fairness — see the 2026-05-22 scope doc).
    if (
      proposal.type === "removeOfficeHolder" &&
      proposal.removeOfficeHolder?.targetCharacterId &&
      characterId.equals(proposal.removeOfficeHolder.targetCharacterId)
    ) {
      return errorResponse(403, "You cannot vote on your own removal");
    }

    const parsed = await parseJsonBody(request, castProposalVoteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { vote } = parsed.data;

    const { currentTurn } = await getGameTime();
    await castVote(db, proposalObjectId, characterId, vote, side, currentTurn);

    // Re-fetch to get the updated proposal for the response
    const updated = await db
      .collection<CommitteeProposal>("committeeProposals")
      .findOne({ _id: proposalObjectId });

    return NextResponse.json({
      success: true,
      status: updated?.status ?? "open",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
