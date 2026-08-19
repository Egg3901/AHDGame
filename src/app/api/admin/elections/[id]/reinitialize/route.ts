/**
 * POST /api/admin/elections/[id]/reinitialize
 * Admin: Full nuclear reset of a presidential election.
 *
 * Deletes all candidates, vote tallies, and campaigns tied to this election,
 * then resets it to a fresh active state with new timers anchored to NOW.
 *
 * The election cycle (and therefore year title) is computed from the current
 * game turn so the election aligns with the correct LARP presidential year:
 *   - If the current game year is a presidential year → use it
 *   - Otherwise → use the next upcoming presidential year
 *
 * Default durations: 72h primary + 48h campaign = 120h total.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election, GameState } from "@/lib/db/types";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const DEFAULT_PRIMARY_HOURS = DEFAULT_DURATIONS.president.primaryDurationHours;
const DEFAULT_CAMPAIGN_HOURS = DEFAULT_DURATIONS.president.generalDurationHours;

/** Next presidential election year at or after the given game year. */
function nextPresYear(gameYear: number): number {
  if (gameYear % 4 === 0) return gameYear;
  return gameYear + (4 - (gameYear % 4));
}

/** Cycle number for a presidential election year (1-indexed, anchored to startingYear). */
function yearToCycle(year: number, startingYear: number): number {
  return Math.floor((year - startingYear) / 4) + 1;
}

// POST /api/admin/elections/[id]/reinitialize — Fully resets a presidential election: deletes all candidates, tallies, and campaigns, then resets timers from now.
// Auth: requireAdmin
// Errors: 400, 403, 404
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
        { error: "Reinitialize is only for presidential elections" },
        { status: 400 }
      );
    }

    // ── Determine correct LARP election year from current game turn ──────────
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 1;
    const startingYear = gameState?.startingYear ?? STARTING_YEAR;
    const currentGameYear = startingYear + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);
    const targetYear = nextPresYear(currentGameYear);
    const correctCycle = yearToCycle(targetYear, startingYear);

    // ── Wipe all associated data ─────────────────────────────────────────────
    const [candidatesResult, talliesResult, campaignsResult] = await Promise.all([
      db.collection("electionCandidates").deleteMany({ electionId: electionObjectId }),
      db.collection("electionVoteTallies").deleteMany({ electionId: electionObjectId }),
      db.collection("campaigns").deleteMany({ electionId: electionObjectId }),
    ]);

    // ── Reset election document ──────────────────────────────────────────────
    const now = new Date();
    const primaryEndTime = new Date(now.getTime() + DEFAULT_PRIMARY_HOURS * 3_600_000);
    const endTime = new Date(
      now.getTime() + (DEFAULT_PRIMARY_HOURS + DEFAULT_CAMPAIGN_HOURS) * 3_600_000
    );

    await db.collection<Election>("elections").updateOne(
      { _id: electionObjectId },
      {
        $set: {
          status: "active",
          cycle: correctCycle,
          electionYear: targetYear,
          startTime: now,
          primaryEndTime,
          endTime,
          // Turn bounds for the turn-first resolver (1 turn = 1 hour), anchored
          // to the current turn so the reinitialized race resolves on schedule.
          startTurn: currentTurn,
          primaryEndTurn: currentTurn + DEFAULT_PRIMARY_HOURS,
          endTurn: currentTurn + DEFAULT_PRIMARY_HOURS + DEFAULT_CAMPAIGN_HOURS,
          primaryDurationHours: DEFAULT_PRIMARY_HOURS,
          durationHours: DEFAULT_PRIMARY_HOURS + DEFAULT_CAMPAIGN_HOURS,
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      success: true,
      message: `${targetYear} presidential election reinitialized. Primary: ${DEFAULT_PRIMARY_HOURS}h, Campaign: ${DEFAULT_CAMPAIGN_HOURS}h.`,
      electionYear: targetYear,
      cycle: correctCycle,
      primaryEndTime: primaryEndTime.toISOString(),
      endTime: endTime.toISOString(),
      deleted: {
        candidates: candidatesResult.deletedCount,
        tallies: talliesResult.deletedCount,
        campaigns: campaignsResult.deletedCount,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
