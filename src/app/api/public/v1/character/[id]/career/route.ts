import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCharacterCareer } from "@/lib/publicApi/character";

// GET /api/public/v1/character/[id]/career
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await publicApiGuard(request, "character");
    if (!guard.ok) return guard.response;

    const { id } = await params;
    const db = await getDb();
    const result = await queryCharacterCareer(db, id);

    if (!result) {
      return errorResponse(404, "Character not found", { code: "NOT_FOUND", extra: { ok: false } });
    }

    return NextResponse.json({ ok: true, found: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
