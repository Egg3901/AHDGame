import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";
import type { Election, GameState } from "@/lib/db/types";

/**
 * GET /api/admin/heal/presidential-election
 *
 * Dry-run: shows the current presidential election state and what would be fixed.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const liveElection = await db
      .collection<Election>("elections")
      .findOne({ electionType: "president", status: { $in: ["active", "upcoming"] } });

    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });

    if (!liveElection) {
      return NextResponse.json({
        status: "no_live_election",
        message: "No active/upcoming presidential election found.",
        gameState: {
          currentTurn: gameState?.currentTurn,
          currentYear: gameState?.currentYear,
        },
      });
    }

    const correctDur = DEFAULT_DURATIONS.president.durationHours;
    const correctPrimary = DEFAULT_DURATIONS.president.primaryDurationHours;
    const needsFix =
      liveElection.durationHours !== correctDur ||
      liveElection.primaryDurationHours !== correctPrimary;

    return NextResponse.json({
      status: needsFix ? "needs_fix" : "ok",
      election: {
        id: liveElection._id.toString(),
        cycle: liveElection.cycle,
        status: liveElection.status,
        durationHours: liveElection.durationHours,
        primaryDurationHours: liveElection.primaryDurationHours,
        startTime: liveElection.startTime,
        primaryEndTime: liveElection.primaryEndTime,
        endTime: liveElection.endTime,
      },
      correctValues: {
        durationHours: correctDur,
        primaryDurationHours: correctPrimary,
      },
      gameState: {
        currentTurn: gameState?.currentTurn,
        currentYear: gameState?.currentYear,
        lastTurnProcessed: gameState?.lastTurnProcessed,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/presidential-election
 *
 * Fixes the active presidential election:
 * - Resets durationHours and primaryDurationHours to DEFAULT_DURATIONS
 * - Recalculates startTime, primaryEndTime, endTime based on lastTurnProcessed
 * - Withdraws any stale candidates if election was bugged
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });

    if (!gameState) {
      return NextResponse.json({ error: "GameState not found" }, { status: 500 });
    }

    const now = new Date(gameState.lastTurnProcessed);
    const correctDur = DEFAULT_DURATIONS.president.durationHours;
    const correctPrimary = DEFAULT_DURATIONS.president.primaryDurationHours;

    const liveElection = await db
      .collection<Election>("elections")
      .findOne({ electionType: "president", status: { $in: ["active", "upcoming"] } });

    if (!liveElection) {
      return NextResponse.json({
        healed: false,
        message: "No active/upcoming presidential election to heal.",
      });
    }

    // Recalculate timestamps anchored to now (lastTurnProcessed)
    const newStartTime = now;
    const newPrimaryEndTime = new Date(now.getTime() + correctPrimary * 3_600_000);
    const newEndTime = new Date(now.getTime() + correctDur * 3_600_000);

    await db.collection<Election>("elections").updateOne(
      { _id: liveElection._id },
      {
        $set: {
          status: "active" as const,
          durationHours: correctDur,
          primaryDurationHours: correctPrimary,
          startTime: newStartTime,
          primaryEndTime: newPrimaryEndTime,
          endTime: newEndTime,
          startTurn: gameState.currentTurn,
          primaryEndTurn: gameState.currentTurn + correctPrimary,
          endTurn: gameState.currentTurn + correctDur,
          updatedAt: now,
        },
      }
    );

    // Also withdraw any candidates from the old bugged election
    // (they can re-enter the healed primary)
    const withdrawn = await db
      .collection("electionCandidates")
      .updateMany(
        { electionId: liveElection._id, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );

    return NextResponse.json({
      healed: true,
      electionId: liveElection._id.toString(),
      previousValues: {
        durationHours: liveElection.durationHours,
        primaryDurationHours: liveElection.primaryDurationHours,
        startTime: liveElection.startTime,
        endTime: liveElection.endTime,
      },
      newValues: {
        durationHours: correctDur,
        primaryDurationHours: correctPrimary,
        startTime: newStartTime,
        primaryEndTime: newPrimaryEndTime,
        endTime: newEndTime,
      },
      candidatesWithdrawn: withdrawn.modifiedCount,
      message: `Presidential election healed. ${correctPrimary}h primary + ${correctDur - correctPrimary}h general. ${withdrawn.modifiedCount} candidate(s) withdrawn for re-entry.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
