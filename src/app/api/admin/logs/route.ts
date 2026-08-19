import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { AdminLog, AdminLogCategory } from "@/lib/db/types";

// GET /api/admin/logs — List admin action logs with optional category filter and limit.
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    // Verify admin authentication
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as AdminLogCategory | null;
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const db = await getDb();

    // Build query based on category filter
    const query = category ? { category } : {};

    const logs = await db
      .collection<AdminLog>("adminLogs")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Format logs for response
    const formattedLogs = logs.map((log) => ({
      id: log._id.toString(),
      category: log.category,
      action: log.action,
      username: log.username,
      characterName: log.characterName || null,
      adminUsername: log.adminUsername || null,
      details: log.details || null,
      createdAt: log.createdAt.toISOString(),
    }));

    return NextResponse.json({
      logs: formattedLogs,
      total: formattedLogs.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
