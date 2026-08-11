import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseBoundedIntParam } from "@/lib/api/validate";
import type { ModAuditLogEntry } from "@/lib/db/types";

// GET /api/admin/moderators/audit-log — View moderator audit log with filtering and pagination.
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const moderatorId = searchParams.get("moderatorId");
    const action = searchParams.get("action");
    const cursor = searchParams.get("cursor");
    const limit = parseBoundedIntParam(searchParams, "limit", 50, 1, 100);

    const filter: Record<string, unknown> = {};
    if (moderatorId && moderatorId.length === 24) {
      filter.moderatorId = new ObjectId(moderatorId);
    }
    if (action) {
      filter.action = action;
    }
    if (cursor && cursor.length === 24) {
      filter._id = { $lt: new ObjectId(cursor) };
    }

    const db = await getDb();
    const entries = await db
      .collection<ModAuditLogEntry>("modAuditLog")
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;

    return NextResponse.json({
      entries: page.map((e) => ({
        id: e._id.toString(),
        moderatorId: e.moderatorId.toString(),
        moderatorName: e.moderatorName,
        action: e.action,
        targetUserId: e.targetUserId?.toString() ?? null,
        targetUsername: e.targetUsername ?? null,
        details: e.details ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]._id.toString() : null,
      hasMore,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
