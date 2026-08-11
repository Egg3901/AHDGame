/**
 * Public crisis detail for the player-facing detail page.
 * GET /api/crises/[id]
 * Auth: none required
 * Errors: 404 if not found or invalid ID
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getCrisisDetail } from "@/lib/crises/queries/crisisQueries";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();
    return NextResponse.json({ crisis: await getCrisisDetail(db, id) });
  } catch (error) {
    return handleRouteError(error);
  }
}
