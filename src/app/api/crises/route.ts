/**
 * Public crisis listing for the player-facing crisis page.
 * GET /api/crises?scope=global|country|region&status=active|resolved|all
 * Auth: none required
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { listCrises } from "@/lib/crises/queries/crisisQueries";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const db = await getDb();

    return NextResponse.json(
      await listCrises(db, searchParams.get("scope"), searchParams.get("status"))
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
