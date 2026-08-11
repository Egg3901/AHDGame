/**
 * POST /api/admin/elections/[id]/start-primary
 * Admin: (Re-)open the primary phase for a presidential election.
 *
 * Resets startTime and primaryEndTime from NOW so the primary is live.
 * Uses the election's stored primaryDurationHours, falling back to the
 * canonical presidential primary duration.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election } from "@/lib/db/types";
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";
import { getGameTime } from "@/lib/time/gameTime";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const DEFAULT_PRIMARY_HOURS = DEFAULT_DURATIONS.president.primaryDurationHours;
const DEFAULT_GENERAL_HOURS = DEFAULT_DURATIONS.president.generalDurationHours;

// POST /api/admin/elections/[id]/start-primary — Opens or re-opens the primary phase for a presidential election, resetting timers from now.
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
    const election = await db.collection<Election>("elections").findOne({
      _id: electionObjectId,
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    if (election.electionType !== "president") {
      return NextResponse.json(
        { error: "Start primary is only for presidential elections" },
        { status: 400 }
      );
    }

    if (election.status === "completed" || election.status === "cancelled") {
      return NextResponse.json(
        { error: "Cannot start primary for completed or cancelled election" },
        { status: 400 }
      );
    }

    const now = new Date();
    const { currentTurn } = await getGameTime();
    const primaryHours = election.primaryDurationHours ?? DEFAULT_PRIMARY_HOURS;
    const primaryEndTime = new Date(now.getTime() + primaryHours * 3_600_000);

    // Also push endTime out so general phase still has its full window
    const campaignHours =
      (election.durationHours ?? DEFAULT_PRIMARY_HOURS + DEFAULT_GENERAL_HOURS) -
      (election.primaryDurationHours ?? DEFAULT_PRIMARY_HOURS);
    const safeCampaignHours = Math.max(campaignHours, DEFAULT_GENERAL_HOURS);
    const endTime = new Date(primaryEndTime.getTime() + safeCampaignHours * 3_600_000);

    await db.collection<Election>("elections").updateOne(
      { _id: electionObjectId },
      {
        // Turn bounds drive the turn-first resolver (1 turn = 1 hour); the
        // (re)opened primary runs `primaryHours` turns from the current turn.
        $set: {
          status: "active",
          startTime: now,
          primaryEndTime,
          endTime,
          startTurn: currentTurn,
          primaryEndTurn: currentTurn + primaryHours,
          endTurn: currentTurn + primaryHours + safeCampaignHours,
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      success: true,
      message: `Primary opened — runs for ${primaryHours}h (until ${primaryEndTime.toLocaleString()}).`,
      primaryEndTime: primaryEndTime.toISOString(),
      endTime: endTime.toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
