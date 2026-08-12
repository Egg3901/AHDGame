import { z } from "zod";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { resolveCorporationVoteIfReady } from "@/lib/corporations/votes/voteService";
import { applyPassedVoteEffects } from "@/lib/corporations/votes/voteEffects";
import { notifyVoteEvent } from "@/lib/corporations/votes/voteNotifications";
import { directableFundsFor } from "@/lib/corporations/votes/fundStewardship";
import { getGameState } from "@/lib/gameState";
import { totalVotingPower } from "@/lib/corporations/superShares";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CorporationVote } from "@/lib/db/types/corporationVote";

/**
 * Fund stewardship instructions.
 *
 * A unit holder controlling half a fund's units directs how it votes the shares
 * it holds. Without this surface the resolver had no instruction to read, so
 * every fund fell through to mirror-or-abstain and buying units was never a
 * route to corporate influence.
 *
 * GET  lists the funds the caller can direct on this vote, with any instruction
 *      already given.
 * POST records or replaces one instruction.
 * DELETE withdraws it, which returns the fund to mirror-or-abstain rather than
 *      making it vote the other way.
 */

const DirectSchema = z.object({
  fundId: z.string(),
  vote: z.enum(["yes", "no"]),
});

const WithdrawSchema = z.object({ fundId: z.string() });

interface RouteParams {
  params: Promise<{ id: string; voteId: string }>;
}

async function loadContext(id: string, voteId: string) {
  if (!ObjectId.isValid(voteId)) {
    return { ok: false as const, response: NextResponse.json({ error: "Invalid vote ID" }, { status: 400 }) };
  }
  const db = await getDb();
  const resolved = await resolveCorporation(db, id);
  if (!resolved.ok) return { ok: false as const, response: resolved.response };

  const vote = await db.collection<CorporationVote>("corporationVotes").findOne({
    _id: new ObjectId(voteId),
    corporationId: resolved.corporation._id,
  });
  if (!vote) {
    return { ok: false as const, response: NextResponse.json({ error: "Vote not found" }, { status: 404 }) };
  }
  return { ok: true as const, db, corporation: resolved.corporation, vote };
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { id, voteId } = await params;
    const ctx = await loadContext(id, voteId);
    if (!ctx.ok) return ctx.response;

    const funds = await directableFundsFor(ctx.db, ctx.corporation, auth.user.character._id);
    const given = new Map(
      (ctx.vote.fundDirections ?? []).map((d) => [d.fundId.toString(), d.vote])
    );

    return NextResponse.json({
      funds: funds.map((f) => ({
        fundId: f.fundId.toString(),
        name: f.name,
        tickerSymbol: f.tickerSymbol,
        unitShare: f.unitShare,
        votingPower: f.votingPower,
        instruction: given.get(f.fundId.toString()) ?? null,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { id, voteId } = await params;
    const ctx = await loadContext(id, voteId);
    if (!ctx.ok) return ctx.response;
    const { db, corporation, vote } = ctx;

    if (vote.status !== "open") {
      return NextResponse.json({ error: "This vote is no longer open" }, { status: 409 });
    }

    const parsed = await parseJsonBody(request, DirectSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!ObjectId.isValid(parsed.data.fundId)) {
      return NextResponse.json({ error: "Invalid fund ID" }, { status: 400 });
    }
    const fundId = new ObjectId(parsed.data.fundId);

    // Authorize against the same directorship check the resolver uses, so the
    // two can never disagree about who controls a fund.
    const directable = await directableFundsFor(db, corporation, auth.user.character._id);
    if (!directable.some((f) => f.fundId.equals(fundId))) {
      return NextResponse.json(
        { error: "You do not control enough units of that fund to direct its vote" },
        { status: 403 }
      );
    }

    const now = new Date();
    await db.collection<CorporationVote>("corporationVotes").updateOne({ _id: vote._id }, [
      {
        $set: {
          fundDirections: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ["$fundDirections", []] },
                  cond: { $ne: ["$$this.fundId", fundId] },
                },
              },
              [
                {
                  fundId,
                  directorCharacterId: auth.user.character._id,
                  vote: parsed.data.vote,
                  castAt: now,
                },
              ],
            ],
          },
          updatedAt: now,
        },
      },
    ]);

    await resolveIfReady(db, vote._id, corporation);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { id, voteId } = await params;
    const ctx = await loadContext(id, voteId);
    if (!ctx.ok) return ctx.response;
    const { db, corporation, vote } = ctx;

    if (vote.status !== "open") {
      return NextResponse.json({ error: "This vote is no longer open" }, { status: 409 });
    }

    const parsed = await parseJsonBody(request, WithdrawSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!ObjectId.isValid(parsed.data.fundId)) {
      return NextResponse.json({ error: "Invalid fund ID" }, { status: 400 });
    }
    const fundId = new ObjectId(parsed.data.fundId);

    // Only the character who gave the instruction can withdraw it. A director
    // who has since lost control cannot withdraw either, but their instruction
    // is already ignored at resolve time.
    const result = await db.collection<CorporationVote>("corporationVotes").updateOne(
      { _id: vote._id },
      {
        $pull: {
          fundDirections: { fundId, directorCharacterId: auth.user.character._id },
        },
        $set: { updatedAt: new Date() },
      }
    );
    if (result.modifiedCount === 0) {
      return NextResponse.json({ error: "No instruction of yours to withdraw" }, { status: 404 });
    }

    await resolveIfReady(db, vote._id, corporation);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * An instruction can be the thing that decides a vote, so the same
 * resolve-and-apply pass the cast-vote route runs happens here too. Without it
 * a decisive direction would sit open until someone loaded the vote page.
 */
async function resolveIfReady(db: Db, voteId: ObjectId, corporation: Corporation) {
  const updated = await db
    .collection<CorporationVote>("corporationVotes")
    .findOne({ _id: voteId });
  if (!updated || updated.status !== "open") return;

  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 0;
  const { outcome, claimed } = await resolveCorporationVoteIfReady({
    db,
    vote: updated,
    totalEligibleShares: totalVotingPower(corporation),
    currentTurn,
  });
  if (!claimed || outcome === "open") return;

  if (outcome === "passed") {
    await applyPassedVoteEffects({ db, vote: updated, corporation, currentTurn });
  }
  await notifyVoteEvent({
    db,
    vote: updated,
    corpName: corporation.name,
    notificationType: outcome === "passed" ? "corp_vote_passed" : "corp_vote_failed",
  });
}
