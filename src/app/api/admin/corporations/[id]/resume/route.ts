// POST /api/admin/corporations/[id]/resume
// Clears suspension — corporation re-enters turn processing next cycle.
// Auth: requireAdmin
// Errors: 401, 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const result = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { suspended: false, suspendedUntilTurn: 0, updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) throw notFound("Corporation not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
