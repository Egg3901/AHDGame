import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { isCorporationCeoVoteDuplicateKey } from "@/lib/elections/duplicateKey";
import type { Corporation } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import { bulkFetchCharacterNames } from "@/lib/db/characterLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { holdsAnyBondsInCorp } from "@/lib/bonds/ceoBondConflict";
import { shareholderVotingPower } from "@/lib/corporations/superShares";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CeoVote {
  _id: ObjectId;
  corporationId: ObjectId;
  voterCharacterId: ObjectId;
  voterCorporationId?: ObjectId;
  candidateCharacterId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

function dedupeCeoVotes(votes: CeoVote[]): CeoVote[] {
  // Dedupe by voter identity — a character voter and a corporation voter are
  // distinct entries (different voter field), so they must not collapse into
  // each other.
  const latestByVoter = new Map<string, CeoVote>();
  for (const vote of votes) {
    const voterKey = (vote.voterCorporationId ?? vote.voterCharacterId).toString();
    const existing = latestByVoter.get(voterKey);
    if (!existing) {
      latestByVoter.set(voterKey, vote);
      continue;
    }
    const voteTime = vote.updatedAt?.getTime?.() ?? vote.createdAt.getTime();
    const existingTime = existing.updatedAt?.getTime?.() ?? existing.createdAt.getTime();
    if (
      voteTime > existingTime ||
      (voteTime === existingTime && vote._id.toString() > existing._id.toString())
    ) {
      latestByVoter.set(voterKey, vote);
    }
  }
  return [...latestByVoter.values()];
}

/**
 * Build a map of voter-identity → voting-power for all shareholders in the corp.
 *
 * Character shareholders are keyed by their characterId (supershare-weighted).
 * Corporation shareholders are keyed by "corp:" + corpId (common stock = 1 vote
 * each, even in dual-class corps — superShares are a character-only concept).
 *
 * Also returns a set of managed-corp-ids for the given voter's character, so
 * the POST handler can determine whether the voter qualifies as a corp-shareholder.
 */
function buildShareholderVoteMap(corporation: Corporation): Map<string, number> {
  const map = new Map<string, number>();
  for (const sh of corporation.shareholders ?? []) {
    if (sh.shares <= 0) continue;
    if (sh.characterId) {
      map.set(sh.characterId.toString(), shareholderVotingPower(corporation, sh));
    } else if (sh.corporationId) {
      // Corp-held shares are always common stock (1 vote each) — superShares
      // are a character-level concept stamped on the founder only.
      map.set(`corp:${sh.corporationId.toString()}`, sh.shares);
    }
  }
  return map;
}

/**
 * POST /api/corporations/[id]/ceo/vote
 * Cast a vote for a CEO candidate. Must be a shareholder (character or
 * corporation). Votes are weighted by the voter's voting power (supershare-
 * weighted for dual-class corps, so a founder's supershares protect them as CEO).
 * Candidates must be in the corporation's HQ state and home country. Self-voting is allowed.
 * Body: { candidateCharacterId: string }
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { character: voterCharacter } = auth.user;
    const { id } = await params;
    const parsed = await parseJsonBody(
      request,
      z.object({ candidateCharacterId: schemas.objectId })
    );
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { candidateCharacterId } = parsed.data;

    const db = await getDb();

    // Resolve corporation
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Must be a shareholder — check character first, then managed corporations.
    let voterCorporationId: ObjectId | null = null;
    const charShareholding = (corporation.shareholders ?? []).some(
      (sh) => sh.characterId?.toString() === voterCharacter._id.toString() && sh.shares > 0
    );

    if (!charShareholding) {
      // Check if the user is CEO of a corporation that holds shares in this corp.
      const managedCorps = await db
        .collection<Corporation>("corporations")
        .find({ ceoId: voterCharacter._id, ceoType: { $ne: "npp" } }, { projection: { _id: 1 } })
        .toArray();

      const holdingCorp = managedCorps.find((mc) =>
        (corporation.shareholders ?? []).some(
          (sh) => sh.corporationId?.equals(mc._id) && sh.shares > 0
        )
      );

      if (holdingCorp) {
        voterCorporationId = holdingCorp._id;
      } else {
        return NextResponse.json({ error: "Only shareholders can vote for CEO" }, { status: 403 });
      }
    }

    // Candidate must exist and be in the corporation's HQ state
    const candidateOid = new ObjectId(candidateCharacterId);
    const candidate = await db
      .collection<Character>("characters")
      .findOne(
        { _id: candidateOid },
        { projection: { name: 1, userId: 1, homeState: 1, countryId: 1 } }
      );
    if (!candidate) {
      return NextResponse.json({ error: "Candidate character not found" }, { status: 404 });
    }
    if (candidate.homeState !== corporation.headquartersState) {
      return NextResponse.json(
        { error: "Candidate must be located in the corporation's HQ state" },
        { status: 403 }
      );
    }
    if (corporation.countryId && candidate.countryId !== corporation.countryId) {
      return NextResponse.json(
        { error: "Candidate must be in the corporation's home country" },
        { status: 403 }
      );
    }

    // Upsert vote (one vote per shareholder per corporation).
    // A character voter and a corporation voter are distinct — the unique key
    // is (corporationId, voterCharacterId) + (corporationId, voterCorporationId).
    const now = new Date();
    const upsertFilter: Record<string, unknown> = {
      corporationId: corporation._id,
    };
    if (voterCorporationId) {
      upsertFilter.voterCorporationId = voterCorporationId;
    } else {
      upsertFilter.voterCharacterId = voterCharacter._id;
      upsertFilter.voterCorporationId = { $exists: false };
    }

    try {
      await db.collection<Omit<CeoVote, "_id">>("corporationCeoVotes").updateOne(
        upsertFilter,
        {
          $set: {
            candidateCharacterId: candidateOid,
            updatedAt: now,
          },
          $setOnInsert: {
            corporationId: corporation._id,
            voterCharacterId: voterCharacter._id,
            ...(voterCorporationId ? { voterCorporationId } : {}),
            createdAt: now,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (!isCorporationCeoVoteDuplicateKey(error)) {
        throw error;
      }
      await db.collection<Omit<CeoVote, "_id">>("corporationCeoVotes").updateOne(upsertFilter, {
        $set: {
          candidateCharacterId: candidateOid,
          updatedAt: now,
        },
      });
    }

    // Tally all votes for this corporation, weighted by voting power
    const allVotesRaw = await db
      .collection<CeoVote>("corporationCeoVotes")
      .find({ corporationId: corporation._id })
      .toArray();
    const allVotes = dedupeCeoVotes(allVotesRaw);

    // Build shareholder map for vote weighting (supershare-weighted voting
    // power for characters, common-stock 1:1 for corporation holders).
    const shareholderMap = buildShareholderVoteMap(corporation);

    // Count votes per candidate weighted by voter's voting power
    const voteCounts = new Map<string, number>();
    for (const v of allVotes) {
      let voterKey: string;
      if (v.voterCorporationId) {
        voterKey = `corp:${v.voterCorporationId.toString()}`;
      } else {
        voterKey = v.voterCharacterId.toString();
      }
      const voterShares = shareholderMap.get(voterKey) ?? 0;
      if (voterShares > 0) {
        const cid = v.candidateCharacterId.toString();
        voteCounts.set(cid, (voteCounts.get(cid) ?? 0) + voterShares);
      }
    }

    // Find the leading candidate
    let leaderId: string | null = null;
    let maxVotes = 0;
    for (const [cid, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        leaderId = cid;
      }
    }

    // If leading candidate changed, send them a CEO offer notification
    const prevPending = corporation.pendingCeoCharacterId?.toString() ?? null;
    // A candidate who holds the corp's bonds cannot lead it (CEO ⊥ bondholder).
    // Their votes still count toward the tally, but no CEO offer is created for
    // them — the seat stays unoffered until a non-bondholder leads or they divest.
    const leaderHoldsBonds = leaderId
      ? (await holdsAnyBondsInCorp(db, new ObjectId(leaderId), "characterId", corporation._id))
          .holds
      : false;

    if (leaderId && leaderId !== prevPending && !leaderHoldsBonds) {
      // Update pending CEO offer on corporation
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corporation._id },
          { $set: { pendingCeoCharacterId: new ObjectId(leaderId), updatedAt: now } }
        );

      // Look up the new leader's user ID to send notification
      const leaderChar = await db
        .collection<Character>("characters")
        .findOne({ _id: new ObjectId(leaderId) }, { projection: { userId: 1, name: 1 } });

      if (leaderChar?.userId) {
        // Skip notification if candidate is already CEO of this corporation
        const isAlreadyCeo = !corporation.ceoVacant && corporation.ceoId?.toString() === leaderId;

        if (!isAlreadyCeo) {
          await createNotification({
            userId: leaderChar.userId,
            type: "ceo_vote_offer",
            title: "CEO Position Offered",
            message: `Shareholders of ${corporation.name} have voted you as their top choice for CEO. Visit the corporation page to accept or decline the position.`,
            metadata: {
              corporationId: corporation._id.toString(),
              corporationSequentialId: corporation.sequentialId,
              corporationName: corporation.name,
            },
          });
        }
      }
    }

    return NextResponse.json({ success: true, totalVotes: allVotes.length });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * GET /api/corporations/[id]/ceo/vote
 * Get vote tallies (voting-power-weighted) and the current user's vote for this corporation.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const user = await getAuthUserWithCharacter();
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const allVotesRaw = await db
      .collection<CeoVote>("corporationCeoVotes")
      .find({ corporationId: corporation._id })
      .toArray();
    const allVotes = dedupeCeoVotes(allVotesRaw);

    // Build shareholder map for vote weighting (supershare-weighted voting
    // power for characters, common-stock 1:1 for corporation holders).
    const shareholderMap = buildShareholderVoteMap(corporation);

    // Count votes per candidate weighted by voter's voting power
    const voteCounts = new Map<string, number>();
    let totalSharesVoted = 0;
    for (const v of allVotes) {
      let voterKey: string;
      if (v.voterCorporationId) {
        voterKey = `corp:${v.voterCorporationId.toString()}`;
      } else {
        voterKey = v.voterCharacterId.toString();
      }
      const voterShares = shareholderMap.get(voterKey) ?? 0;
      if (voterShares > 0) {
        const cid = v.candidateCharacterId.toString();
        voteCounts.set(cid, (voteCounts.get(cid) ?? 0) + voterShares);
        totalSharesVoted += voterShares;
      }
    }

    // Resolve candidate names
    const candidateIds = [...voteCounts.keys()];
    const charMap = await bulkFetchCharacterNames(db, candidateIds, { includeAvatar: true });

    const tallies = [...voteCounts.entries()]
      .map(([cid, count]) => ({
        characterId: cid,
        name: charMap.get(cid)?.name ?? "Unknown",
        sequentialId: charMap.get(cid)?.sequentialId,
        avatarUrl: charMap.get(cid)?.avatarUrl,
        votes: count,
      }))
      .sort((a, b) => b.votes - a.votes);

    // Find current user's vote if logged in — check both character and
    // managed-corporation identities.
    let myVote: string | null = null;
    if (user?.character) {
      const myVoteDoc = allVotes.find(
        (v: CeoVote) => v.voterCharacterId.toString() === user.character!._id.toString()
      );
      myVote = myVoteDoc?.candidateCharacterId.toString() ?? null;
    }

    return NextResponse.json({
      tallies,
      myVote,
      totalVoters: allVotes.length,
      totalSharesVoted,
      pendingCeoCharacterId: corporation.pendingCeoCharacterId?.toString() ?? null,
      headquartersState: corporation.headquartersState,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
