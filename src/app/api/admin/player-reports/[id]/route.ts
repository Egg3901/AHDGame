import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import type { PlayerContentReport } from "@/lib/db/types";
import { PLAYER_CONTENT_REPORTS } from "@/lib/safety/playerSafety";

const reviewSchema = z.object({
  status: z.enum(["dismissed", "actioned"]),
  adminNote: z.string().max(500).optional(),
});

// PATCH /api/admin/player-reports/[id] — Close a player content report
// Auth: requireModerator (admins and moderators)
// Errors: 400, 401, 403, 404
// Enforcement (editing a bio, warning, banning) happens with the existing
// moderator tools; this records the outcome on the report.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
    }
    const parsed = await parseJsonBody(request, reviewSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const now = new Date();
    const updated = await db
      .collection<PlayerContentReport>(PLAYER_CONTENT_REPORTS)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: parsed.data.status,
            reviewedAt: now,
            reviewedByAdminId: new ObjectId(auth.user.userId),
            ...(parsed.data.adminNote?.trim() ? { adminNote: parsed.data.adminNote.trim() } : {}),
          },
        },
        { returnDocument: "after" }
      );
    if (!updated) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, status: updated.status });
  } catch (err) {
    return handleRouteError(err);
  }
}
