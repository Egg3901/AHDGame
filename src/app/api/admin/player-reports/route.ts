import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import type { PlayerContentReport } from "@/lib/db/types";
import { PLAYER_CONTENT_REPORTS } from "@/lib/safety/playerSafety";

// GET /api/admin/player-reports — List player content reports (paginated, filterable by status)
// Auth: requireModerator (admins and moderators)
export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const offset = Math.max(0, parseInt(searchParams.get("offset") || "0") || 0);
    const limit = parseBoundedIntParam(searchParams, "limit", 20, 1, 50);
    const status = searchParams.get("status");
    const filter =
      status && ["pending", "dismissed", "actioned"].includes(status)
        ? { status: status as PlayerContentReport["status"] }
        : {};

    const db = await getDb();
    const reports = db.collection<PlayerContentReport>(PLAYER_CONTENT_REPORTS);
    const [rows, total] = await Promise.all([
      reports.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      reports.countDocuments(filter),
    ]);

    return NextResponse.json({
      reports: rows.map((r) => ({
        ...r,
        _id: r._id.toHexString(),
        reportedByUserId: r.reportedByUserId.toHexString(),
        targetUserId: r.targetUserId.toHexString(),
        targetCharacterId: r.targetCharacterId.toHexString(),
        reviewedByAdminId: r.reviewedByAdminId?.toHexString(),
      })),
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
