import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryParty } from "@/lib/publicApi/party";

// GET /api/public/v1/party?id=ID&country=CODE
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "party");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const country = url.searchParams.get("country");

    if (!id || !country) {
      return errorResponse(400, "id and country are required", { code: "BAD_REQUEST", extra: { ok: false } });
    }

    const members = url.searchParams.get("members") === "true";
    const membersPage = parseInt(url.searchParams.get("membersPage") ?? "1", 10) || 1;
    const membersLimit = Math.min(parseInt(url.searchParams.get("membersLimit") ?? "50", 10) || 50, 100);

    const db = await getDb();
    const result = await queryParty(db, { id, country, members, membersPage, membersLimit });

    if (!result) {
      return errorResponse(404, "Party not found", { code: "NOT_FOUND", extra: { ok: false } });
    }

    return NextResponse.json({ ok: true, found: true, party: result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
