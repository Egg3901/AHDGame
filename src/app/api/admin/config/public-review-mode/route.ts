import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";

const patchSchema = z.object({
  enabled: z.boolean(),
});

// GET /api/admin/config/public-review-mode — Anonymous read-only content toggle
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { publicReviewMode: 1 } });

    const enabled = config?.publicReviewMode === true;

    return NextResponse.json({ enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/public-review-mode — Toggle anonymous read-only content access
// Auth: requireAdmin
// Errors: 400, 403
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { enabled } = parsed.data;

    const db = await getDb();
    await db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { publicReviewMode: enabled } }, { upsert: true });

    await createAdminLog({
      category: "system",
      action: enabled ? "public_review_mode_enabled" : "public_review_mode_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: enabled
        ? "Public read-only mode is enabled — anonymous visitors can view content pages read-only."
        : "Public read-only mode is disabled — gated content requires auth as usual.",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
