import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getTaskLessonsCollection } from "@/lib/db/collections/taskLessons";
import { getTasksCollection } from "@/lib/db/collections/tasks";
import { z } from "zod";
import type { TaskLesson } from "@/lib/db/types/taskLesson";

// GET /api/admin/tasks/lessons — Return all lessons learned with task titles joined in.
// Auth: requireAdminOrApiKey
// Errors: 401, 403
/**
 * GET /api/admin/tasks/lessons
 * Returns all lessons learned, with task titles joined in.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const lessons = await getTaskLessonsCollection(db).find({}).sort({ createdAt: -1 }).toArray();

    // Join task titles
    const taskIds = lessons.map((l) => l.taskId).filter((id): id is ObjectId => id !== null);

    const tasks =
      taskIds.length > 0
        ? await getTasksCollection(db)
            .find({ _id: { $in: taskIds } })
            .project({ _id: 1, title: 1 })
            .toArray()
        : [];

    const taskTitleMap = new Map(tasks.map((t) => [t._id.toString(), t.title]));

    const enriched = lessons.map((l) => ({
      ...l,
      taskTitle: l.taskId ? (taskTitleMap.get(l.taskId.toString()) ?? null) : null,
    }));

    return NextResponse.json({ lessons: enriched });
  } catch (error) {
    return handleRouteError(error);
  }
}

const createLessonSchema = z.object({
  lesson: z.string().min(1).max(2000),
  category: z.enum(["bug", "design", "process", "technical", "general"]),
  taskId: z.string().length(24).optional(),
  tags: z
    .array(z.string().trim().min(1).max(30))
    .max(20)
    .default([])
    .transform((arr) => [...new Set(arr)]),
});

// POST /api/admin/tasks/lessons — Log a new lesson learned entry.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403
/**
 * POST /api/admin/tasks/lessons
 * Log a lesson learned. Called programmatically by Claude — no UI form.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, createLessonSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const now = new Date();

    const result = await getTaskLessonsCollection(db).insertOne({
      taskId: parsed.data.taskId ? new ObjectId(parsed.data.taskId) : null,
      lesson: parsed.data.lesson,
      category: parsed.data.category,
      tags: parsed.data.tags,
      createdAt: now,
    } as TaskLesson);

    const lesson = await getTaskLessonsCollection(db).findOne({ _id: result.insertedId });
    return NextResponse.json({ lesson }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
