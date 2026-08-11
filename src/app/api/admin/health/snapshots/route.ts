import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";

/**
 * List game health snapshots with optional turn range filter.
 * Auth: requireAdmin()
 * Errors: 401, 500
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 48, 200);
    const fromRaw = Number(url.searchParams.get("from"));
    const toRaw = Number(url.searchParams.get("to"));
    const from = url.searchParams.get("from") && !isNaN(fromRaw) ? fromRaw : undefined;
    const to = url.searchParams.get("to") && !isNaN(toRaw) ? toRaw : undefined;

    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (from !== undefined || to !== undefined) {
      filter.turn = {};
      if (from !== undefined) (filter.turn as Record<string, number>).$gte = from;
      if (to !== undefined) (filter.turn as Record<string, number>).$lte = to;
    }

    const snapshots = await db
      .collection("gameHealthSnapshots")
      .find(filter)
      .sort({ turn: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ snapshots });
  } catch (error) {
    return handleRouteError(error);
  }
}
