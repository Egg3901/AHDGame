import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import type { PoliticianOverride } from "@/lib/db/types";
import { handleRouteError } from "@/lib/api/errors";

// GET /api/politician-overrides — Returns all politician profile overrides (admin only)
// Auth: requireBasicAuth
// Errors: 401, 403
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;
    if (!user.isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const db = await getDb();
    const overrides = await db
      .collection<PoliticianOverride>("politicianOverrides")
      .find({})
      .sort({ politicianId: 1 })
      .toArray();

    return NextResponse.json(overrides);
  } catch (error) {
    return handleRouteError(error);
  }
}
