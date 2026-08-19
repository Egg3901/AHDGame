import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { getTaskCommentsCollection } from "@/lib/db/collections/taskComments";
import { getTasksCollection } from "@/lib/db/collections/tasks";
import { z } from "zod";
import type { TaskComment } from "@/lib/db/types/taskComment";

// GET /api/admin/tasks/[id]/comments — Return all comments for a task, sorted oldest first.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403, 404, 500
/**
 * GET /api/admin/tasks/[id]/comments
 * Returns all comments for a task, oldest first.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }

    const db = await getDb();
    const taskId = new ObjectId(id);

    // Verify task exists
    const task = await getTasksCollection(db).findOne({ _id: taskId });
    if (!task) {
      return NextResponse.json(notFound("Task not found").toJson(), { status: 404 });
    }

    const comments = await getTaskCommentsCollection(db)
      .find({ taskId })
      .sort({ createdAt: 1 })
      .toArray();

    return NextResponse.json({ comments });
  } catch (error) {
    return handleRouteError(error);
  }
}

const createCommentSchema = z.object({
  body: z.string().min(1).max(2000),
  statusChange: z.enum(["pending", "in_progress", "completed"]).optional(),
});

// POST /api/admin/tasks/[id]/comments — Add a comment to a task, optionally updating its status.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403, 404, 500
/**
 * POST /api/admin/tasks/[id]/comments
 * Add a comment, optionally updating task status.
 * Author is inferred from auth method: "claude" for API key, "user" for session.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, createCommentSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const taskId = new ObjectId(id);

    // Verify task exists
    const task = await getTasksCollection(db).findOne({ _id: taskId });
    if (!task) {
      return NextResponse.json(notFound("Task not found").toJson(), { status: 404 });
    }

    const now = new Date();
    const author = auth.via === "apiKey" ? "claude" : "user";

    // Insert comment
    const result = await getTaskCommentsCollection(db).insertOne({
      taskId,
      body: parsed.data.body,
      author,
      ...(parsed.data.statusChange ? { statusChange: parsed.data.statusChange } : {}),
      createdAt: now,
    } as TaskComment);

    // If statusChange provided, update the task
    if (parsed.data.statusChange) {
      const updateFields: Record<string, unknown> = {
        status: parsed.data.statusChange,
        updatedAt: now,
      };
      if (parsed.data.statusChange === "completed") {
        updateFields.completedAt = now;
      }
      await getTasksCollection(db).updateOne({ _id: taskId }, { $set: updateFields });
    }

    const comment = await getTaskCommentsCollection(db).findOne({ _id: result.insertedId });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
