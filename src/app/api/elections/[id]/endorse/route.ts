import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import type { ElectionCandidate, PlayerEndorsement } from "@/lib/db/types";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { isPrimaryPhaseOpen } from "@/lib/elections/playerEndorsements";
import { getGameTime } from "@/lib/time/gameTime";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isActivePlayerEndorsementDuplicateKey } from "@/lib/elections/duplicateKey";
import { assertSameCountry } from "@/lib/api/sameCountry";
import { applyEndorsementSupportBump } from "@/lib/turn/elections/supportEvents";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/endorse — Endorse a candidate in a presidential election, replacing any prior endorsement.
// Auth: requireHumanSessionWithCharacter (bot tokens rejected)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const character = auth.user.character;

    const { id: electionId } = await params;

    const parsed = await parseJsonBody(request, z.object({ candidateId: schemas.objectId }));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { candidateId } = parsed.data;

    const db = await getDb();
    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") {
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const election = resolved.election;
    const electionObjectId = election._id;
    const candidateObjectId = new ObjectId(candidateId);
    if (election.electionType !== "president") {
      return NextResponse.json(
        { error: "Endorsements are only available for presidential elections" },
        { status: 400 }
      );
    }
    if (election.status === "completed" || election.status === "resolved") {
      return NextResponse.json({ error: "This election has ended" }, { status: 400 });
    }
    assertSameCountry(character, election, {
      message: "You cannot endorse candidates in elections from other countries",
    });

    // Verify candidate exists in this election
    const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      _id: candidateObjectId,
      electionId: electionObjectId,
      status: "active",
    });
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found in this election" }, { status: 404 });
    }

    // Cannot endorse yourself
    if (candidate.characterId?.equals(character._id)) {
      return NextResponse.json({ error: "You cannot endorse yourself" }, { status: 400 });
    }

    // Primaries are intra-party contests — the /president/primary/[partyId]
    // surface only ever offered this control to same-party members, so hold
    // the API to the same rule (ticket #1179). Cross-party endorsements open
    // up in the general phase. Turn-first phase check with Date fallback.
    const { effectiveNow, currentTurn } = await getGameTime();
    const inPrimary = isPrimaryPhaseOpen(election, { currentTurn, now: effectiveNow });
    if (inPrimary && candidate.party && candidate.party !== character.party) {
      return NextResponse.json(
        { error: "You can only endorse candidates in your own party while the primary is running" },
        { status: 403 }
      );
    }

    const ownCandidacy = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: electionObjectId,
      characterId: character._id,
      status: "active",
    });
    if (ownCandidacy?.campaignSuspended) {
      return NextResponse.json(
        { error: "Suspended presidential candidates cannot issue player endorsements" },
        { status: 400 }
      );
    }

    // Reverse the Support bump of any endorsement we're about to replace. The
    // bump is non-idempotent (applyEndorsementSupportBump docstring), and only the
    // DELETE path previously applied the negative form — so re-POSTing endorse (same
    // candidate, or flipping A→B→A) stacked +SUPPORT_ENDORSEMENT_BUMP every call
    // with no reversal, letting a single account pump any candidate to the clamp.
    // Reverse here so a replacement nets to zero on the old candidate before the new
    // bump lands. Skip NPP candidates (bump was never applied to them).
    const priorEndorsements = await db
      .collection<PlayerEndorsement>("playerEndorsements")
      .find({ characterId: character._id, electionId: electionObjectId, isActive: true })
      .toArray();
    for (const prior of priorEndorsements) {
      const priorCandidate = await db
        .collection<ElectionCandidate>("electionCandidates")
        .findOne({ _id: prior.candidateId });
      if (priorCandidate && !priorCandidate.isNPP && priorCandidate.characterId) {
        await applyEndorsementSupportBump(db, priorCandidate.characterId, true);
      }
    }

    // Withdraw any existing active endorsement for this election
    await db.collection<PlayerEndorsement>("playerEndorsements").updateMany(
      {
        characterId: character._id,
        electionId: electionObjectId,
        isActive: true,
      },
      {
        $set: { isActive: false, withdrawnAt: new Date() },
      }
    );

    // Create new endorsement. Key by the candidate row id so consumers can
    // join to electionCandidates without guessing the underlying character.
    const endorsement: PlayerEndorsement = {
      _id: new ObjectId(),
      characterId: character._id,
      characterName: character.name,
      electionId: electionObjectId,
      candidateId: candidate._id,
      candidateName: candidate.characterName,
      isActive: true,
      createdAt: new Date(),
    };

    try {
      await db.collection<PlayerEndorsement>("playerEndorsements").insertOne(endorsement);
    } catch (error) {
      if (isActivePlayerEndorsementDuplicateKey(error)) {
        const activeEndorsement = await db
          .collection<PlayerEndorsement>("playerEndorsements")
          .findOne({
            characterId: character._id,
            electionId: electionObjectId,
            isActive: true,
          });

        if (activeEndorsement) {
          return NextResponse.json({
            success: true,
            endorsement: {
              id: activeEndorsement._id.toString(),
              candidateId: activeEndorsement.candidateId.toString(),
              candidateName: activeEndorsement.candidateName,
            },
          });
        }
      }

      throw error;
    }

    // B3 — endorsement landing bumps Support on the endorsed candidate.
    // One-shot; revocation in DELETE applies the negative form. Skip
    // for NPP candidates — applySupportDelta is keyed by characterId
    // which doesn't map for NPPs, and NPP "support" isn't a meaningful
    // game-state field.
    if (!candidate.isNPP) {
      await applyEndorsementSupportBump(db, candidate.characterId);
    }

    recordAudit({
      source: "api",
      action: "election.endorse",
      category: "election",
      subject: { type: "election", id: electionObjectId, name: `president — ${election.state}` },
      counterparty: {
        type: "character",
        id: candidate.characterId ?? candidateObjectId,
        name: candidate.characterName,
      },
      refs: { electionId: electionObjectId },
      meta: { candidateId: candidateObjectId.toString() },
      outcome: "ok",
    });

    return NextResponse.json({
      success: true,
      endorsement: {
        id: endorsement._id.toString(),
        candidateId: candidate._id.toString(),
        candidateName: candidate.characterName,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/elections/[id]/endorse — Withdraw the authenticated character's active endorsement from a presidential election.
// Auth: requireHumanSessionWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const rateLimitDel = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimitDel.ok) return rateLimitResponse(rateLimitDel.retryAfter);
    const character = auth.user.character;

    const { id: electionId } = await params;

    const db = await getDb();
    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") {
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const electionObjectId = resolved.election._id;

    // B3 — capture endorsed candidates before deactivating so we can
    // reverse their Support bump. Only player-character candidates need
    // the reverse — NPP endorsement candidates were skipped on the POST
    // path so their revocation is a no-op too.
    const activeEndorsements = await db
      .collection<PlayerEndorsement>("playerEndorsements")
      .find({
        characterId: character._id,
        electionId: electionObjectId,
        isActive: true,
      })
      .project<{ candidateId: ObjectId }>({ candidateId: 1 })
      .toArray();

    // Resolve candidate rows so we can filter NPPs from the bump reversal.
    // playerEndorsements.candidateId is the candidate row id, not the
    // character id, so join by _id.
    const candidateIds: ObjectId[] = activeEndorsements.map((e) => e.candidateId);
    const candidateRows =
      candidateIds.length > 0
        ? await db
            .collection<ElectionCandidate>("electionCandidates")
            .find({
              electionId: electionObjectId,
              _id: { $in: candidateIds },
            })
            .project<{ _id: ObjectId; characterId: ObjectId; isNPP?: boolean }>({
              _id: 1,
              characterId: 1,
              isNPP: 1,
            })
            .toArray()
        : [];
    const isNppByCandidateId = new Map<string, boolean>(
      candidateRows.map((c) => [c._id.toString(), c.isNPP === true])
    );
    const characterIdByCandidateId = new Map<string, ObjectId>(
      candidateRows.map((c) => [c._id.toString(), c.characterId])
    );

    const result = await db.collection<PlayerEndorsement>("playerEndorsements").updateMany(
      {
        characterId: character._id,
        electionId: electionObjectId,
        isActive: true,
      },
      {
        $set: { isActive: false, withdrawnAt: new Date() },
      }
    );

    // Apply the revocation Support penalty to each previously-endorsed
    // player-character candidate. Symmetric with the landing bump in POST.
    for (const e of activeEndorsements) {
      const candidateId = e.candidateId.toString();
      if (isNppByCandidateId.get(candidateId)) continue;
      const candidateCharacterId = characterIdByCandidateId.get(candidateId);
      if (!candidateCharacterId) continue;
      await applyEndorsementSupportBump(db, candidateCharacterId, true);
    }

    if (result.modifiedCount > 0) {
      recordAudit({
        source: "api",
        action: "election.endorse_withdraw",
        category: "election",
        subject: { type: "election", id: electionObjectId },
        refs: { electionId: electionObjectId },
        meta: {
          withdrawnCount: result.modifiedCount,
          candidateIds: activeEndorsements.map((e) => e.candidateId.toString()),
        },
        outcome: "ok",
      });
    }

    return NextResponse.json({
      success: true,
      withdrawn: result.modifiedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
