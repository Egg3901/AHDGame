/**
 * POST /api/admin/elections/[id]/reset-timers
 * Admin: Reset presidential election timers from NOW.
 *
 * Resets startTime, primaryEndTime, and endTime relative to the current
 * wall-clock time so the election runs fresh from this moment forward.
 *
 * Body (all optional):
 *   primaryHours  – primary phase length in hours  (default: 72)
 *   campaignHours – general campaign length in hours (default: 48)
 *
 * Total duration = primaryHours + campaignHours (default: 120h)
 *
 * Works even if the election is already completed — use this to restart a
 * stuck or mis-timed presidential election without respawning the whole cycle.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Election } from "@/lib/db/types";
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";
import { getGameTime } from "@/lib/time/gameTime";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const DEFAULT_PRIMARY_HOURS = DEFAULT_DURATIONS.president.primaryDurationHours;
const DEFAULT_CAMPAIGN_HOURS = DEFAULT_DURATIONS.president.generalDurationHours;

const resetTimersSchema = z.object({
  primaryHours: z.number().positive().optional(),
  campaignHours: z.number().positive().optional(),
});

// POST /api/admin/elections/[id]/reset-timers — Resets a presidential election's primary and general timers from the current wall-clock time.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id: electionId } = await params;
    let electionObjectId: ObjectId;
    try {
      electionObjectId = new ObjectId(electionId);
    } catch {
      return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
    }

    const db = await getDb();
    const election = await db.collection<Election>("elections").findOne({ _id: electionObjectId });

    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    if (election.electionType !== "president") {
      return NextResponse.json(
        { error: "Reset timers is only for presidential elections" },
        { status: 400 }
      );
    }

    const parsed = await parseJsonBody(request, resetTimersSchema);
    const body = parsed.success ? parsed.data : {};
    const primaryHours = body.primaryHours ?? DEFAULT_PRIMARY_HOURS;
    const campaignHours = body.campaignHours ?? DEFAULT_CAMPAIGN_HOURS;

    const totalHours = primaryHours + campaignHours;
    const now = new Date();
    const primaryEndTime = new Date(now.getTime() + primaryHours * 3_600_000);
    const endTime = new Date(now.getTime() + totalHours * 3_600_000);
    // Turn bounds drive the turn-first resolver (1 turn = 1 hour): reset starts
    // at the current turn and runs the requested number of turns from there.
    const { currentTurn } = await getGameTime();

    await db.collection<Election>("elections").updateOne(
      { _id: electionObjectId },
      {
        $set: {
          status: "active",
          startTime: now,
          primaryEndTime,
          endTime,
          startTurn: currentTurn,
          primaryEndTurn: currentTurn + primaryHours,
          endTurn: currentTurn + totalHours,
          primaryDurationHours: primaryHours,
          durationHours: totalHours,
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      success: true,
      message: `Timers reset. Primary ends in ${primaryHours}h, general ends in ${totalHours}h.`,
      primaryHours,
      campaignHours,
      totalHours,
      startTime: now.toISOString(),
      primaryEndTime: primaryEndTime.toISOString(),
      endTime: endTime.toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
