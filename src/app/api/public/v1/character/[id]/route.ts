import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { publicError } from "@/lib/publicApi/errors";
import { queryCharacterById } from "@/lib/publicApi/character";

// GET /api/public/v1/character/[id]
// Auth: X-API-Key or X-Bot-Token (PUBLIC_BOT_API_KEY)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await publicApiGuard(request, "character");
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const db = await getDb();
    const result = await queryCharacterById(db, id);

    if (!result) {
      return publicError("NOT_FOUND", "Character not found", 404);
    }

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
