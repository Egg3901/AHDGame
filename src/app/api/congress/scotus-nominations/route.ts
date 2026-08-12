/**
 * GET /api/congress/scotus-nominations — Active SCOTUS nominations for Senate voting
 *
 * Mirrors /api/congress/cabinet-nominations so the Senate Bills tab can list
 * Justice confirmations the same way it lists cabinet confirmations (#1050).
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import type { ScotusNomination } from "@/lib/db/types/scotus";
import { computeCabinetNominationTally } from "@/lib/congress/governmentVoteBreakdown";

// GET /api/congress/scotus-nominations — Returns all active SCOTUS nominations with the current user's vote status.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const db = await getDb();
    const authUser = await verifyAuth().catch(() => null);

    const activeNominations = await db
      .collection<ScotusNomination>("scotusNominations")
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
        const myVote = myCharId ? (n.votes?.[myCharId] ?? null) : null;
        const tally = await computeCabinetNominationTally(db, n.countryId ?? "US", n.votes);
        return {
          id: n._id.toString(),
          kind: "scotus" as const,
          seatNumber: n.seatNumber,
          positionName: `Supreme Court Seat #${n.seatNumber}`,
          nomineeMode: n.nomineeMode,
          nomineeCharacterId: n.nomineeCharacterId?.toString() ?? null,
          nomineeCharacterName: n.nomineeName,
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
