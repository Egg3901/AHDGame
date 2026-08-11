import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCharacterAchievements } from "@/lib/publicApi/character";

// GET /api/public/v1/character/[id]/achievements
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await publicApiGuard(request, "character");
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const db = await getDb();
    const result = await queryCharacterAchievements(db, id);

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Character not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, found: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
