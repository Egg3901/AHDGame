/**
 * GET /api/congress/cabinet-nominations/[id] — Single cabinet nomination for detail page
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import type { CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";
import { getCabinetPositionById } from "@/lib/constants";
import { computeCabinetNominationTally } from "@/lib/congress/governmentVoteBreakdown";

// GET /api/congress/cabinet-nominations/[id] — Returns full detail for a single cabinet nomination including vote tallies.
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
      .collection<CabinetNomination>("cabinetNominations")
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
        })
      : null;
    const isSenator = !!senatorOfficial;
    const myCharId = myCharacter?._id.toString();
    const myVote = myCharId ? (nomination.votes?.[myCharId] ?? null) : null;
    const myWhippedFrom = myCharId ? (nomination.whippedFromVote?.[myCharId] ?? null) : null;

    const pos = getCabinetPositionById(nomination.positionId);

    // Fetch the nominee's sequentialId and countryId (fallback for legacy docs without countryId)
    const nomineeChar = await db
      .collection<Character>("characters")
      .findOne(
        { _id: nomination.nomineeCharacterId },
        { projection: { sequentialId: 1, countryId: 1 } }
      );
    const nomineeSequentialId = nomineeChar?.sequentialId;
    const countryId = nomination.countryId ?? nomineeChar?.countryId ?? "US";

    // While voting is open, recompute the tally from the current senate seats so
    // the page can never show more votes than seats (de-seated / cross-country
    // NPP keys carry no weight). Once closed, trust the stored final tally —
    // the resolver reconciled it at close time.
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
      countryId,
      positionId: nomination.positionId,
      positionName: pos?.name ?? nomination.positionId,
      nomineeCharacterId: nomination.nomineeCharacterId.toString(),
      nomineeSequentialId,
      nomineeCharacterName: nomination.nomineeCharacterName,
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
