/**
 * GET /api/congress/scotus-nominations/[id] — Single SCOTUS nomination for detail page
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import type { ScotusNomination } from "@/lib/db/types/scotus";
import { computeCabinetNominationTally } from "@/lib/congress/governmentVoteBreakdown";

// GET /api/congress/scotus-nominations/[id] — Returns full detail for a single SCOTUS nomination including vote tallies.
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let nominationOid: ObjectId;
    try {
      nominationOid = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Invalid nomination ID" }, { status: 400 });
    }

    const db = await getDb();
    const nomination = await db
      .collection<ScotusNomination>("scotusNominations")
      .findOne({ _id: nominationOid });

    if (!nomination) {
      return NextResponse.json({ error: "Nomination not found" }, { status: 404 });
    }

    const authUser = await verifyAuth().catch(() => null);
    const myCharacter = authUser
      ? await db
          .collection<Character>("characters")
          .findOne({ userId: new ObjectId(authUser.userId) })
      : null;
    const senatorOfficial = myCharacter
      ? await db.collection<ElectedOfficial>("electedOfficials").findOne({
          characterId: myCharacter._id,
          officeType: "senate",
          countryId: nomination.countryId ?? "US",
        })
      : null;
    const isSenator = !!senatorOfficial;
    const myCharId = myCharacter?._id.toString();
    const myVote = myCharId ? (nomination.votes?.[myCharId] ?? null) : null;
    const myWhippedFrom = myCharId ? (nomination.whippedFromVote?.[myCharId] ?? null) : null;

    const nomineeChar =
      nomination.nomineeCharacterId != null
        ? await db
            .collection<Character>("characters")
            .findOne(
              { _id: nomination.nomineeCharacterId },
              { projection: { sequentialId: 1, countryId: 1 } }
            )
        : null;
    const countryId = nomination.countryId ?? nomineeChar?.countryId ?? "US";

    const tally =
      nomination.status === "active"
        ? await computeCabinetNominationTally(db, countryId, nomination.votes)
        : {
            votesFor: nomination.votesFor ?? 0,
            votesAgainst: nomination.votesAgainst ?? 0,
            votesAbstain: nomination.votesAbstain ?? 0,
          };

    return NextResponse.json({
      id: nomination._id.toString(),
      kind: "scotus" as const,
      countryId,
      seatNumber: nomination.seatNumber,
      positionName: `Supreme Court Seat #${nomination.seatNumber}`,
      nomineeMode: nomination.nomineeMode,
      nomineeCharacterId: nomination.nomineeCharacterId?.toString() ?? null,
      nomineeSequentialId: nomineeChar?.sequentialId,
      nomineeCharacterName: nomination.nomineeName,
      nomineeParty: nomination.nomineeParty,
      proposedByPresidentName: nomination.proposedByPresidentName ?? "President",
      status: nomination.status,
      votesFor: tally.votesFor,
      votesAgainst: tally.votesAgainst,
      votesAbstain: tally.votesAbstain,
      votingEndsAt: nomination.votingEndsAt?.toISOString() ?? null,
      proposedAt: nomination.proposedAt?.toISOString() ?? new Date().toISOString(),
      myVote,
      myWhippedFrom,
      isSenator,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
