import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { badRequest, forbidden, handleRouteError, notFound } from "@/lib/api/errors";
import { z } from "zod";
import { getGameTime } from "@/lib/time/gameTime";
import {
  MAX_ACTIVE_COALITION_PRIORITIES,
  normalizeCoalitionPriorities,
  shouldActivatePriority,
  shouldRejectPriority,
  upsertCoalitionPriorityVote,
} from "@/lib/coalitions/priorities";
import {
  loadCoalitionPriorityContext,
  parseCoalitionCountry,
  resolveCoalitionPriorityViewer,
} from "@/lib/coalitions/priorityApi";

const voteSchema = z.object({
  vote: z.enum(["support", "oppose", "abstain"]),
});

// POST /api/country/[code]/coalitions/[id]/priorities/[priorityId]/vote â€” Member party chairs cast or update their coalition priority vote.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; priorityId: string }> }
) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { code, id, priorityId } = await params;
    const countryId = parseCoalitionCountry(code);
    if (!countryId) {
      throw badRequest("Invalid country code.");
    }

    const sequentialId = Number.parseInt(id, 10);
    if (!Number.isFinite(sequentialId)) {
      throw badRequest("Coalition ID must be a number.");
    }

    const parsed = await parseJsonBody(request, voteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const context = await loadCoalitionPriorityContext(db, countryId, sequentialId);
    if (!context) {
      throw notFound("Coalition not found.");
    }

    const viewer = resolveCoalitionPriorityViewer(auth.user, context);
    if (!viewer.canVote || !viewer.partyObjectId || !viewer.characterObjectId) {
      throw forbidden("Only member party chairs can vote on coalition priorities.");
    }

    const now = new Date();
    const gameTime = await getGameTime();
    const normalized = normalizeCoalitionPriorities(
      context.coalition,
      context.billsById,
      now,
      gameTime.currentTurn
    );
    const priorities = [...normalized.priorities];
    const priorityIndex = priorities.findIndex((priority) => priority.id === priorityId);
    if (priorityIndex < 0) {
      throw notFound("Coalition priority not found.");
    }

    const priority = { ...priorities[priorityIndex], votes: [...priorities[priorityIndex].votes] };
    if (!["proposed", "active"].includes(priority.status)) {
      throw badRequest("Only proposed or active priorities can be voted on.");
    }

    priority.votes = upsertCoalitionPriorityVote(priority.votes, {
      partyId: context.memberParties.find((party) => party._id.toString() === viewer.partyObjectId)!
        ._id,
      chairCharacterId: auth.user.character._id,
      vote: parsed.data.vote,
      votedAt: now,
    });
    priority.updatedAt = now;

    const activePriorityCount = priorities.filter(
      (entry, index) => index !== priorityIndex && entry.status === "active"
    ).length;

    if (shouldActivatePriority(priority, context.memberParties.length)) {
      if (activePriorityCount >= MAX_ACTIVE_COALITION_PRIORITIES) {
        throw badRequest("Archive an active coalition priority before activating another.");
      }
      priority.status = "active";
      priority.activatedAt = priority.activatedAt ?? now;
    } else if (shouldRejectPriority(priority, context.memberParties.length)) {
      priority.status = "rejected";
      priority.resolvedAt = now;
      priority.resolvedBy = auth.user.character._id;
    }

    priorities[priorityIndex] = priority;
    await db
      .collection("coalitions")
      .updateOne({ _id: context.coalition._id }, { $set: { priorities, updatedAt: now } });

    return NextResponse.json({
      success: true,
      message:
        priority.status === "active"
          ? "Coalition priority activated."
          : priority.status === "rejected"
            ? "Coalition priority rejected."
            : "Coalition priority vote recorded.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
