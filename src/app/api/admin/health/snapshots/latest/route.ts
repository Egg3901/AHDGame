import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";

/**
 * Get the most recent game health snapshot.
 * Auth: requireAdmin()
 * Errors: 401, 404, 500
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const snapshot = await db.collection("gameHealthSnapshots").findOne({}, { sort: { turn: -1 } });

    if (!snapshot) {
      return NextResponse.json({ error: "No snapshots available" }, { status: 404 });
    }

    return NextResponse.json({ snapshot });
  } catch (error) {
    return handleRouteError(error);
  }
}
