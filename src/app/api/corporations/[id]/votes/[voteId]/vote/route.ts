import { z } from "zod";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import {
  castCorporationVote,
  resolveCorporationVoteIfReady,
} from "@/lib/corporations/votes/voteService";
import { applyPassedVoteEffects } from "@/lib/corporations/votes/voteEffects";
import { notifyVoteEvent } from "@/lib/corporations/votes/voteNotifications";
import { getGameState } from "@/lib/gameState";
import { shareholderVotingPower, totalVotingPower } from "@/lib/corporations/superShares";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import type { Corporation } from "@/lib/db/types";

const CastSchema = z.object({
  vote: z.enum(["yes", "no"]),
  /** Optional — when set, vote as this corporation instead of the active character. */
  voterCorporationId: z.string().optional(),
});

interface RouteParams {
  params: Promise<{ id: string; voteId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { character: voterCharacter } = auth.user;

    const { id, voteId } = await params;
    if (!ObjectId.isValid(voteId)) {
      return NextResponse.json({ error: "Invalid vote ID" }, { status: 400 });
    }
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const vote = await db.collection<CorporationVote>("corporationVotes").findOne({
      _id: new ObjectId(voteId),
      corporationId: corporation._id,
    });
    if (!vote) return NextResponse.json({ error: "Vote not found" }, { status: 404 });

    const parsed = await parseJsonBody(request, CastSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { vote: choice, voterCorporationId } = parsed.data;

    // Resolve the voter's shareholding. If voterCorporationId is explicitly
    // provided, vote as that corporation (must be CEO of it and it must hold
    // shares). Otherwise, vote as the active character (respects
    // activeCharacterId for multi-character support — Bug #0832).
    // If the character holds no shares, auto-detect a managed corporation
    // that holds shares (multi-CEO path).
    let voterId: ObjectId;
    let voterType: "character" | "corporation";
    let voteShares: number;

    if (voterCorporationId && ObjectId.isValid(voterCorporationId)) {
      // Explicit corporation vote — verify the user is CEO of this corp
      // and that the corp holds shares in the target.
      const corpOid = new ObjectId(voterCorporationId);
      const managedCorp = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: corpOid, ceoId: voterCharacter._id, ceoType: { $ne: "npp" } },
          { projection: { _id: 1 } }
        );
      if (!managedCorp) {
        return NextResponse.json(
          { error: "You are not the CEO of that corporation" },
          { status: 403 }
        );
      }
      const corpHolding = corporation.shareholders?.find((s) => s.corporationId?.equals(corpOid));
      if (!corpHolding || corpHolding.shares <= 0) {
        return NextResponse.json(
          { error: "That corporation holds no shares in this corporation" },
          { status: 403 }
        );
      }
      voterId = corpOid;
      voterType = "corporation";
      voteShares = corpHolding.shares;
    } else {
      // Character vote (default) — check the active character first.
      const charShareholding = corporation.shareholders?.find((s) =>
        s.characterId?.equals(voterCharacter._id)
      );
      if (charShareholding && charShareholding.shares > 0) {
        voterId = voterCharacter._id;
        voterType = "character";
        voteShares = shareholderVotingPower(corporation, charShareholding);
      } else {
        // Auto-detect a managed corporation that holds shares.
        const managedCorps = await db
          .collection<Corporation>("corporations")
          .find({ ceoId: voterCharacter._id, ceoType: { $ne: "npp" } }, { projection: { _id: 1 } })
          .toArray();

        let corpHolding: {
          shareholder: NonNullable<Corporation["shareholders"]>[number];
          corpId: ObjectId;
        } | null = null;
        for (const mc of managedCorps) {
          const sh = corporation.shareholders?.find((s) => s.corporationId?.equals(mc._id));
          if (sh && sh.shares > 0) {
            corpHolding = { shareholder: sh, corpId: mc._id };
            break;
          }
        }

        if (corpHolding) {
          voterId = corpHolding.corpId;
          voterType = "corporation";
          voteShares = corpHolding.shareholder.shares;
        } else {
          return NextResponse.json(
            { error: "You hold no shares in this corporation" },
            { status: 403 }
          );
        }
      }
    }

    const result = await castCorporationVote({
      db,
      vote,
      voterId,
      voterType,
      voteShares,
      choice,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    // Re-fetch the vote with the newly cast ballot and check for immediate resolution.
    // Without this, a decisive vote (e.g. 68% YES meeting a 50% threshold) would leave
    // the vote open until someone manually loads the vote detail page (GET), delaying
    // any share issuance or governance change by an arbitrary amount of time.
    const updatedVote = await db
      .collection<CorporationVote>("corporationVotes")
      .findOne({ _id: vote._id });
    if (updatedVote && updatedVote.status === "open") {
      const gameState = await getGameState();
      const currentTurn = gameState?.currentTurn ?? 0;
      const { outcome, claimed } = await resolveCorporationVoteIfReady({
        db,
        vote: updatedVote,
        totalEligibleShares: totalVotingPower(corporation),
        currentTurn,
      });
      if (claimed && outcome !== "open") {
        if (outcome === "passed") {
          await applyPassedVoteEffects({ db, vote: updatedVote, corporation, currentTurn });
        }
        const notificationType =
          outcome === "passed" ? "corp_vote_passed" : ("corp_vote_failed" as const);
        await notifyVoteEvent({
          db,
          vote: updatedVote,
          corpName: corporation.name,
          notificationType,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
