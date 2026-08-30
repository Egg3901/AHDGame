import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryReferendum } from "@/lib/publicApi/referendums";
import { publicError } from "@/lib/publicApi/errors";

// GET /api/public/v1/referendums/[id]
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await publicApiGuard(request, "referendum-detail");
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const result = await queryReferendum(await getDb(), id);
    if (!result) return publicError("NOT_FOUND", "Referendum not found", 404);
    return NextResponse.json(
      { ok: true, found: true, referendum: result },
      { headers: guard.headers }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
