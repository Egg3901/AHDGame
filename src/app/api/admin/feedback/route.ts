import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import type { Feedback, User } from "@/lib/db/types";

const STATUS_OPTIONS = ["open", "in_progress", "resolved", "wont_fix"] as const;

/**
 * GET /api/admin/feedback
 * List all feedback with optional filters.
 * Query: status, type, limit, offset
 */
// GET /api/admin/feedback — List all feedback with optional filtering by status, type, limit, and offset.
// Auth: requireAdmin
// Errors: 401, 403
export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const limit = parseBoundedIntParam(searchParams, "limit", 50, 1, 100);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));

    const db = await getDb();

    const filter: Record<string, unknown> = {};
    if (status && STATUS_OPTIONS.includes(status as (typeof STATUS_OPTIONS)[number])) {
      filter.status = status;
    }
    if (type && ["bug", "suggestion"].includes(type)) {
      filter.type = type;
    }

    const [items, total] = await Promise.all([
      db
        .collection<Feedback>("feedback")
        .find(filter)
        .sort({ issueNumber: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection<Feedback>("feedback").countDocuments(filter),
    ]);

    // Fetch usernames for reporters
    const userIds = [...new Set(items.map((f) => f.userId).filter(Boolean))] as ObjectId[];
    const users =
      userIds.length > 0
        ? await db
            .collection<User>("users")
            .find({ _id: { $in: userIds } })
            .project({ _id: 1, username: 1 })
            .toArray()
        : [];
    const usernameMap = new Map(users.map((u) => [u._id.toString(), u.username]));

    const list = items.map((f) => ({
      id: f._id.toString(),
      issueNumber: f.issueNumber,
      type: f.type,
      category: f.category,
      title: f.title,
      status: f.status,
      severity: f.severity,
      priority: f.priority,
      screenshotUrl: f.screenshotUrl,
      reporterUsername: f.userId ? (usernameMap.get(f.userId.toString()) ?? null) : null,
      githubIssueUrl: f.githubIssueUrl,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      items: list,
      total,
      limit,
      offset,
    });
  } catch (err) {
    return handleRouteError(err);
  }
});
