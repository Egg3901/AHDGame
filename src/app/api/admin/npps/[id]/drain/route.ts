// POST /api/admin/npps/[id]/drain
// Sets an NPP's funds to $0, removing their accumulated campaign capital.
// donorBaseLevel is intentionally preserved — drain removes current funds,
// not future earning capacity. Use the Economy tab to inspect donor levels.
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { schemas } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { NPP } from "@/lib/db/types";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success)
      return NextResponse.json({ error: "Invalid NPP ID" }, { status: 400 });
    const db = await getDb();
    const result = await db
      .collection<NPP>("npps")
      .updateOne({ _id: new ObjectId(id) }, { $set: { funds: 0 } });

    if (result.matchedCount === 0) throw notFound("NPP not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
