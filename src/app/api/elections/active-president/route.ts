import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Election } from "@/lib/db/types";

/**
 * GET - Returns the active presidential election ID + seatId for navbar direct
 * links, scoped to the `?country=` param (default "US"). A national presidential
 * race stores the country code in `state`, so we filter on it. Returns null
 * id/seatId if that country has no active/upcoming presidential race.
 */
// GET /api/elections/active-president?country=XX — active presidential election for navbar links, or null.
// Auth: public
// Errors: none
export async function GET(request: Request) {
  try {
    const country = (new URL(request.url).searchParams.get("country") ?? "US").toUpperCase();
    const db = await getDb();
    const election = await db.collection<Election>("elections").findOne(
      {
        electionType: "president",
        state: country,
        status: { $in: ["active", "upcoming"] },
      },
      { projection: { _id: 1, seatId: 1 } }
    );

    return NextResponse.json(
      election
        ? { id: election._id.toString(), seatId: election.seatId ?? null }
        : { id: null, seatId: null },
      {
        headers: {
          // Public, unauthenticated, hit on every navbar dropdown open. A short
          // shared cache lets Cloudflare absorb the load without going stale as
          // races open/close (matches the /api/v1/leaderboard pattern).
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
