import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getTasksCollection } from "@/lib/db/collections/tasks";
import { z } from "zod";
import type { Task, TaskType, TaskPriority, TaskStatus } from "@/lib/db/types";

// GET /api/admin/tasks — Return all tasks with optional filtering by type, status, and priority.
// Auth: requireAdminOrApiKey
// Errors: 401, 403
/**
 * GET /api/admin/tasks
 * Returns all tasks with optional filtering by type, status, priority
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const tasksCollection = getTasksCollection(db);

    // Parse query params
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type") as TaskType | null;
    const statusFilter = searchParams.get("status") as TaskStatus | null;
    const priorityFilter = searchParams.get("priority") as TaskPriority | null;

    // Build filter object
    const filter: Record<string, unknown> = {};
    if (typeFilter) filter.type = typeFilter;
    if (statusFilter) filter.status = statusFilter;
    if (priorityFilter) filter.priority = priorityFilter;

    // Fetch tasks sorted by priority (desc) then created date (asc)
    const tasks = await tasksCollection.find(filter).sort({ priority: -1, createdAt: 1 }).toArray();

    return NextResponse.json(
      { tasks },
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

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  type: z.enum(["bug", "feature", "improvement"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  tags: z
    .array(z.string().trim().min(1).max(30))
    .max(20)
    .default([])
    .transform((arr) => [...new Set(arr)]),
});

// POST /api/admin/tasks — Create a new task with title, description, type, priority, and tags.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403
/**
 * POST /api/admin/tasks
 * Create new task
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, createTaskSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const tasksCollection = getTasksCollection(db);

    const now = new Date();
    const result = await tasksCollection.insertOne({
      title: parsed.data.title,
      description: parsed.data.description,
      type: parsed.data.type,
      priority: parsed.data.priority,
      tags: parsed.data.tags,
      status: "pending" as const,
      createdAt: now,
      updatedAt: now,
      createdBy:
        auth.via === "session"
          ? new ObjectId(auth.admin.userId)
          : new ObjectId("000000000000000000000001"),
    } as Task);
    const task = await tasksCollection.findOne({ _id: result.insertedId });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
