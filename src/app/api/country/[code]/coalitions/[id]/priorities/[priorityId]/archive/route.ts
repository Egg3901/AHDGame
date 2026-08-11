import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, forbidden, handleRouteError, notFound } from "@/lib/api/errors";
import { normalizeCoalitionPriorities } from "@/lib/coalitions/priorities";
import { getGameTime } from "@/lib/time/gameTime";
import {
  loadCoalitionPriorityContext,
  parseCoalitionCountry,
  resolveCoalitionPriorityViewer,
} from "@/lib/coalitions/priorityApi";

// POST /api/country/[code]/coalitions/[id]/priorities/[priorityId]/archive â€” Coalition chair archives an active or proposed priority.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function POST(
  _request: Request,
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

    const db = await getDb();
    const context = await loadCoalitionPriorityContext(db, countryId, sequentialId);
    if (!context) {
      throw notFound("Coalition not found.");
    }

    const viewer = resolveCoalitionPriorityViewer(auth.user, context);
    if (!viewer.canPropose || !viewer.characterObjectId) {
      throw forbidden("Only the coalition chair can archive priorities.");
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

    const priority = priorities[priorityIndex];
    if (!["proposed", "active"].includes(priority.status)) {
      throw badRequest("Only proposed or active priorities can be archived.");
    }

    priorities[priorityIndex] = {
      ...priority,
      status: "archived",
      updatedAt: now,
      resolvedAt: now,
      resolvedBy: auth.user.character._id,
    };

    await db
      .collection("coalitions")
      .updateOne({ _id: context.coalition._id }, { $set: { priorities, updatedAt: now } });

    return NextResponse.json({
      success: true,
      message: "Coalition priority archived.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
