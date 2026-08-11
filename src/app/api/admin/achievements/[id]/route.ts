import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Achievement } from "@/lib/db/types";
import { invalidateDefinitionsCache } from "@/lib/achievements/cache";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  order: z.number().int().min(0).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH /api/admin/achievements/[id] — Updates an achievement's name, description, icon, or sort order.
// Auth: requireAdmin
// Errors: 400, 401, 404
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid achievement ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const update: Record<string, unknown> = { updatedAt: new Date(), ...parsed.data };

    const result = await db
      .collection<Achievement>("achievements")
      .updateOne({ _id: new ObjectId(id) }, { $set: update });

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Achievement not found" }, { status: 404 });
    }

    invalidateDefinitionsCache();

    return NextResponse.json({ success: true, message: "Achievement updated." });
  } catch (error) {
    return handleRouteError(error);
  }
}
