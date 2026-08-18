// DELETE /api/admin/npps/[id]
// Permanently deletes the NPP, their elected office record, and active election candidacy.
// This is an irreversible admin action — use with caution.
// Auth: requireAdmin
// Errors: 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { schemas } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { NPP } from "@/lib/db/types";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success)
      return NextResponse.json({ error: "Invalid NPP ID" }, { status: 400 });

    const db = await getDb();
    const nppId = new ObjectId(id);

    const npp = await db.collection<NPP>("npps").findOne({ _id: nppId });
    if (!npp) throw notFound("NPP not found");

    // Hard-delete the NPP document and all direct references.
    // nppInfluence and congress vote records are left in place — they are
    // historical and don't affect live game state.
    await Promise.all([
      db.collection("npps").deleteOne({ _id: nppId }),
      db.collection("electedOfficials").deleteMany({ nppId }),
      db.collection("electionCandidates").deleteMany({ nppId }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
