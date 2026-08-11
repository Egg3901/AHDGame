import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findSlateForElection } from "@/lib/db/recruitmentSlateLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Election, ElectionCandidate, SlateCandidate } from "@/lib/db/types";
import { resolveSlateAuthority } from "@/lib/slateAuthority";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";

interface RouteParams {
  params: Promise<{
    code: string;
    id: string;
    electionId: string;
    candidateRowId: string;
  }>;
}

// DELETE /api/country/[code]/parties/[id]/slate/[electionId]/invitations/[candidateRowId] — Party leadership withdraws an invitation
// Auth: requireAuthWithCharacter (must be the national or state chair / vice chair for this race)
// If the slate row is already filed, this also withdraws the live candidate
// from the election (mirrors /api/elections/[id]/withdraw cleanup).
// Errors: 400, 401, 403, 404, 409
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, electionId, candidateRowId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (!ObjectId.isValid(electionId) || !ObjectId.isValid(candidateRowId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });
    const partyId = String(party.sequentialId);
    const electionObjectId = new ObjectId(electionId);
    const slate = await findSlateForElection(db, countryId, partyId, electionObjectId);
    if (!slate) return NextResponse.json({ error: "Slate not found" }, { status: 404 });
    const authority = await resolveSlateAuthority({
      db,
      party,
      stateId: slate.state,
      actorId: auth.user.character._id,
      isAdmin: !!auth.user.isAdmin,
    });
    if (!authority.canManage) {
      return NextResponse.json(
        {
          error:
            "Only the national or state party chair / vice chair for this race can withdraw slate assignments.",
        },
        { status: 403 }
      );
    }

    const row = await db
      .collection<SlateCandidate>("slateCandidates")
      .findOne({ _id: new ObjectId(candidateRowId), slateId: slate._id });
    if (!row) {
      return NextResponse.json({ error: "Invitation not found on this slate" }, { status: 404 });
    }
    const now = new Date();
    if (row.status === "filed") {
      // Filed slate rows have a live electionCandidates entry. Removing the
      // slate handle alone would leave the candidate on the ballot, so mirror
      // the self-withdraw cleanup: mark the candidate withdrawn, scrub the
      // tally, and archive any campaign doc before tombstoning the slate row.
      const election = await db
        .collection<Election>("elections")
        .findOne({ _id: electionObjectId, countryId });
      if (
        !election ||
        election.status === "completed" ||
        election.status === "resolved" ||
        election.status === "cancelled"
      ) {
        return NextResponse.json(
          { error: "Cannot withdraw a filed candidate from a closed race." },
          { status: 409 }
        );
      }

      const filedCandidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
        electionId: electionObjectId,
        characterId: row.candidateId,
        status: "active",
      });
      if (filedCandidate) {
        await db
          .collection<ElectionCandidate>("electionCandidates")
          .updateOne(
            { _id: filedCandidate._id },
            { $set: { status: "withdrawn", withdrawnAt: now } }
          );
        await removeWithdrawnCandidateFromTally(
          db,
          electionObjectId,
          filedCandidate._id.toString()
        );
        await db.collection("campaigns").updateOne(
          {
            electionId: electionObjectId,
            candidateId: filedCandidate.characterId,
            status: { $ne: "archived" },
          },
          {
            $set: {
              status: "archived",
              archivedAt: now,
              archivedReason: "withdrawn",
              updatedAt: now,
            },
          }
        );
      }
    }
    // Tombstone rather than hard-delete. A hard delete empties the slate, so the
    // per-turn syncPersistentSlateAssignments re-hydrates this candidate from the
    // prior-cycle template and the withdrawal silently reverts next turn (#0961).
    // A `withdrawn` tombstone keeps the slate non-empty (blocking re-hydration)
    // and is excluded from the file/override passes and template carry-forward —
    // matching how the POST reassign route already tombstones vacated rows (#906).
    await db
      .collection<SlateCandidate>("slateCandidates")
      .updateOne(
        { _id: row._id },
        { $set: { status: "withdrawn", refusalReason: null, respondedAt: now, updatedAt: now } }
      );
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
