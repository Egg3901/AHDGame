import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryElectionList } from "@/lib/publicApi/election";

// GET /api/public/v1/elections?country=CODE[&state=STATE][&results=true]
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "elections");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const country = url.searchParams.get("country");
    const state = url.searchParams.get("state") ?? undefined;
    // Opt-in richer payload: per-candidate vote standings for every race in the
    // filter, so a bot pulls a whole country's results in one call (ticket #1229).
    const results = url.searchParams.get("results") === "true";

    if (!country) {
      return NextResponse.json(
        { ok: false, error: "country is required", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await queryElectionList(db, { country, state, results });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
