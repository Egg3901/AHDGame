import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryElectionArchives } from "@/lib/publicApi/election";

// GET /api/public/v1/elections/archives?country=CODE&limit=&type=
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "election-archives");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const country = url.searchParams.get("country");
    if (!country) {
      return NextResponse.json(
        { ok: false, error: "Missing required query param: country", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await queryElectionArchives(db, {
      country,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      type: url.searchParams.get("type") ?? undefined,
    });

    return NextResponse.json(
      { ok: true, country: country.toUpperCase(), ...result },
      { headers: guard.headers }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
