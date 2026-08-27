import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryPartyList } from "@/lib/publicApi/party";

// GET /api/public/v1/parties?country=CODE
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "parties");
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
    const result = await queryPartyList(db, { country });

    return NextResponse.json(
      { ok: true, country: country.toUpperCase(), ...result },
      { headers: guard.headers }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
