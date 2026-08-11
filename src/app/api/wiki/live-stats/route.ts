import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import type { ElectedOfficial, Election } from "@/lib/db/types";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";

// GET /api/wiki/live-stats — Returns live congressional composition counts and active election summaries.
// Auth: public; blocked when wiki is disabled
// Errors: 403
export async function GET() {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;
    const db = await getDb();

    // Get Congress makeup
    const [house, senate] = await Promise.all([
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ officeType: "house" })
        .project({ party: 1, seatsHeld: 1 })
        .toArray(),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ officeType: "senate" })
        .project({ party: 1 })
        .toArray(),
    ]);

    const houseCounts = house.reduce(
      (acc, official) => {
        const party = official.party || "Vacant";
        acc[party] = (acc[party] || 0) + (official.seatsHeld ?? 1);
        return acc;
      },
      {} as Record<string, number>
    );

    const senateCounts = senate.reduce(
      (acc, official) => {
        const party = official.party || "Vacant";
        acc[party] = (acc[party] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Get active elections
    const activeElections = await db
      .collection<Election>("elections")
      .find({ status: { $in: ["active", "upcoming"] } })
      .limit(10)
      .sort({ startTime: 1 })
      .toArray();

    // Determine primary vs general phase turn-first (drift-immune) so labels
    // agree with the turn-based resolution.
    const wikiGameTime = await getGameTime();
    const primaryElections = activeElections.filter(
      (e) => !isPrimaryEnded(e, wikiGameTime.currentTurn, wikiGameTime)
    );
    const generalElections = activeElections.filter((e) =>
      isPrimaryEnded(e, wikiGameTime.currentTurn, wikiGameTime)
    );

    const stats = {
      congress: {
        house: houseCounts,
        senate: senateCounts,
        lastUpdated: new Date().toISOString(),
      },
      elections: {
        primaryCount: primaryElections.length,
        generalCount: generalElections.length,
        upcomingElections: activeElections.slice(0, 5).map((e) => ({
          id: e._id.toString(),
          type: e.electionType,
          state: e.state,
          status: e.status,
          startTime: e.startTime?.toISOString(),
          endTime: e.endTime?.toISOString(),
          primaryEndTime: e.primaryEndTime?.toISOString(),
        })),
      },
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=180, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
