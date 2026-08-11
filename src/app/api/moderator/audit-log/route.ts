import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import type { ModAuditLogEntry } from "@/lib/db/types";

// GET /api/moderator/audit-log — list mod action audit log.
// Moderators see only their own actions; admins see all.
// Query params: ?action=&cursor=&limit=50
// Auth: requireModerator
// Errors: 403
export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user } = auth;

    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";
    const cursor = url.searchParams.get("cursor");
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));

    const db = await getDb();
    const auditLogs = db.collection<ModAuditLogEntry>("modAuditLog");

    // Build query filter
    const filter: Record<string, unknown> = {};

    // If moderator (not admin), only show their own actions
    if (!user.isAdmin) {
      filter.moderatorId = user.userId;
    }

    // If action specified, filter by it
    if (action) {
      filter.action = action;
    }

    // If cursor specified, fetch entries before this cursor
    if (cursor) {
      filter.createdAt = { $lt: new Date(cursor) };
    }

    const entries = await auditLogs
      .find(filter, { sort: { createdAt: -1 } })
      .limit(limit + 1) // fetch one extra to detect hasMore
      .toArray();

    const hasMore = entries.length > limit;
    const results = entries.slice(0, limit);
    const nextCursor = results.length > 0 ? results[results.length - 1].createdAt : null;

    return NextResponse.json({
      entries: results.map((entry) => ({
        _id: entry._id.toString(),
        moderatorId: entry.moderatorId,
        moderatorName: entry.moderatorName,
        action: entry.action,
        targetUserId: entry.targetUserId,
        targetUsername: entry.targetUsername,
        details: entry.details,
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: hasMore && nextCursor ? nextCursor.toISOString() : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
