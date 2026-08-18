import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError } from "@/lib/api/errors";
import { getTasksCollection } from "@/lib/db/collections/tasks";

const PRIORITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

// GET /api/admin/tasks/summary — Return summary stats and top priority tasks for the dashboard widget.
// Auth: requireAdminOrApiKey
// Errors: 401, 403, 500
/**
 * GET /api/admin/tasks/summary
 * Returns summary stats and top 5 priority tasks for dashboard widget
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const tasksCollection = getTasksCollection(db);

    const allTasks = await tasksCollection.find({}).toArray();

    // Count by status
    const byStatus = {
      pending: allTasks.filter((t) => t.status === "pending").length,
      in_progress: allTasks.filter((t) => t.status === "in_progress").length,
      completed: allTasks.filter((t) => t.status === "completed").length,
    };

    // Count by priority
    const byPriority = {
      critical: allTasks.filter((t) => t.priority === "critical").length,
      high: allTasks.filter((t) => t.priority === "high").length,
      medium: allTasks.filter((t) => t.priority === "medium").length,
      low: allTasks.filter((t) => t.priority === "low").length,
    };

    // Top 10 priority tasks (pending or in_progress only)
    const activeTasks = allTasks.filter(
      (t) => t.status === "pending" || t.status === "in_progress"
    );
    const sortedActive = activeTasks.sort((a, b) => {
      // Sort by priority desc, then createdAt asc
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const topPriority = sortedActive.slice(0, 10);

    // Recent completed tasks (last 5)
    const completedTasks = allTasks
      .filter((t) => t.status === "completed")
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 5);

    return NextResponse.json(
      {
        total: allTasks.length,
        byStatus,
        byPriority,
        topPriority,
        completedTasks,
      },
      {
        headers: {
          // Admin-only data behind requireAdminOrApiKey: a shared/public cache
          // header lets a CDN replay a prior admin's response to a non-admin or
          // unauthenticated caller hitting the same URL, since the cache serves
          // without re-running auth. no-store, not just a shorter TTL.
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
