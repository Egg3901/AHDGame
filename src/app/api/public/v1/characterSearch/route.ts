import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCharacters } from "@/lib/publicApi/character";

// GET /api/public/v1/characterSearch?name=X  OR  ?discordId=X
// Alias of GET /api/public/v1/character (same auth, params, and response).
// Auth: X-API-Key or X-Bot-Token (PUBLIC_BOT_API_KEY)
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "character");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? undefined;
    const discordId = url.searchParams.get("discordId") ?? undefined;

    if (!name && !discordId) {
      return NextResponse.json(
        { ok: false, error: "Provide name or discordId", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await queryCharacters(db, { name, discordId });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
