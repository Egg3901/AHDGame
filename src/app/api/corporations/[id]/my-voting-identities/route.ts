import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { shareholderVotingPower } from "@/lib/corporations/superShares";
import type { Corporation } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export interface VotingIdentity {
  /** "character" or "corporation" */
  kind: "character" | "corporation";
  /** The ObjectId to pass as voterId to the vote endpoint */
  id: string;
  /** Display name */
  name: string;
  /** Sequential ID for linking */
  sequentialId?: number;
  /** Voting power (supershare-weighted for characters, 1:1 for corps) */
  votingPower: number;
  /** Share count */
  shares: number;
  /** True when this identity has already cast a vote on the given vote */
  hasVoted?: boolean;
}

/**
 * GET /api/corporations/[id]/my-voting-identities
 *
 * Returns all identities the logged-in user can vote with in this corporation:
 * their active character (if a shareholder) and any corporations they are CEO of
 * that hold shares in this target corp. Each identity includes its voting power
 * (supershare-weighted for characters, common-stock 1:1 for corporation holders).
 *
 * Optional query param: ?voteId=<id> — when provided, also marks which identities
 * have already cast a vote on that specific vote.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { character: voterCharacter } = auth.user;
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const url = new URL(request.url);
    const voteId = url.searchParams.get("voteId");

    const identities: VotingIdentity[] = [];

    // 1. Character identity
    const charShareholding = corporation.shareholders?.find((s) =>
      s.characterId?.equals(voterCharacter._id)
    );
    if (charShareholding && charShareholding.shares > 0) {
      identities.push({
        kind: "character",
        id: voterCharacter._id.toString(),
        name: voterCharacter.name,
        sequentialId: voterCharacter.sequentialId,
        votingPower: shareholderVotingPower(corporation, charShareholding),
        shares: charShareholding.shares,
      });
    }

    // 2. Corporation identities — corps where this user is CEO and that hold shares
    const managedCorps = await db
      .collection<Corporation>("corporations")
      .find(
        { ceoId: voterCharacter._id, ceoType: { $ne: "npp" } },
        { projection: { _id: 1, name: 1, sequentialId: 1 } }
      )
      .toArray();

    for (const mc of managedCorps) {
      const sh = corporation.shareholders?.find((s) => s.corporationId?.equals(mc._id));
      if (sh && sh.shares > 0) {
        identities.push({
          kind: "corporation",
          id: mc._id.toString(),
          name: mc.name,
          sequentialId: mc.sequentialId,
          votingPower: sh.shares, // Corp-held shares are always common stock
          shares: sh.shares,
        });
      }
    }

    // 3. If voteId provided, mark which identities have already voted
    if (voteId && ObjectId.isValid(voteId) && identities.length > 0) {
      const vote = await db
        .collection("corporationVotes")
        .findOne({ _id: new ObjectId(voteId), corporationId: corporation._id });

      if (vote) {
        const votedCharIds = new Set(
          vote.votes
            .filter((v: { characterId?: ObjectId }) => v.characterId)
            .map((v: { characterId: ObjectId }) => v.characterId.toString())
        );
        const votedCorpIds = new Set(
          vote.votes
            .filter((v: { corporationId?: ObjectId }) => v.corporationId)
            .map((v: { corporationId: ObjectId }) => v.corporationId.toString())
        );

        for (const ident of identities) {
          if (ident.kind === "character") {
            ident.hasVoted = votedCharIds.has(ident.id);
          } else {
            ident.hasVoted = votedCorpIds.has(ident.id);
          }
        }
      }
    }

    return NextResponse.json({ identities });
  } catch (e) {
    return handleRouteError(e);
  }
}
