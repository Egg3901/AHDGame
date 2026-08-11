/**
 * GET /api/congress/cabinet-nominations — Active cabinet nominations for Senate voting
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import type { CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";
import { getCabinetPositionById } from "@/lib/constants";
import { computeCabinetNominationTally } from "@/lib/congress/governmentVoteBreakdown";

// GET /api/congress/cabinet-nominations — Returns all active cabinet nominations with the current user's vote status.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const db = await getDb();
    const authUser = await verifyAuth().catch(() => null);

    const activeNominations = await db
      .collection<CabinetNomination>("cabinetNominations")
      .find({ status: "active", countryId: "US" })
      .sort({ proposedAt: -1 })
      .toArray();

    const myCharacter = authUser
      ? await db
          .collection<Character>("characters")
          .findOne({ userId: new ObjectId(authUser.userId) })
      : null;

    const senatorOfficial = myCharacter
      ? await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: myCharacter._id,
          officeType: "senate",
          countryId: "US",
        })
      : null;

    const isSenator = !!senatorOfficial;
    const myCharId = myCharacter?._id.toString();

    const nominations = await Promise.all(
      activeNominations.map(async (n) => {
        const pos = getCabinetPositionById(n.positionId);
        const myVote = myCharId ? (n.votes?.[myCharId] ?? null) : null;
        // These are all active US nominations — recompute the seat-weighted
        // tally so the list can never show more votes than senate seats.
        const tally = await computeCabinetNominationTally(db, n.countryId ?? "US", n.votes);
        return {
          id: n._id.toString(),
          positionId: n.positionId,
          positionName: pos?.name ?? n.positionId,
          nomineeCharacterId: n.nomineeCharacterId.toString(),
          nomineeCharacterName: n.nomineeCharacterName,
          nomineeParty: n.nomineeParty,
          proposedByPresidentName: n.proposedByPresidentName ?? "President",
          status: n.status,
          votesFor: tally.votesFor,
          votesAgainst: tally.votesAgainst,
          votesAbstain: tally.votesAbstain,
          votingEndsAt: n.votingEndsAt?.toISOString() ?? null,
          proposedAt: n.proposedAt?.toISOString() ?? new Date().toISOString(),
          myVote,
        };
      })
    );

    return NextResponse.json({
      nominations,
      isSenator,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
