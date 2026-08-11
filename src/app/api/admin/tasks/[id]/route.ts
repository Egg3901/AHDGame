import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { getTasksCollection } from "@/lib/db/collections/tasks";
import { z } from "zod";

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).optional(),
  type: z.enum(["bug", "feature", "improvement"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
  tags: z
    .array(z.string().trim().min(1).max(30))
    .max(20)
    .optional()
    .transform((arr) => (arr ? [...new Set(arr)] : arr)),
});

// PATCH /api/admin/tasks/[id] — Update an existing task's fields such as title, status, or priority.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403, 404
/**
 * PATCH /api/admin/tasks/[id]
 * Update existing task
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, updateTaskSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const tasksCollection = getTasksCollection(db);

    // Build update object
    const now = new Date();
    const updateFields: Record<string, unknown> = {
      updatedAt: now,
    };

    if (parsed.data.title !== undefined) updateFields.title = parsed.data.title;
    if (parsed.data.description !== undefined) updateFields.description = parsed.data.description;
    if (parsed.data.type !== undefined) updateFields.type = parsed.data.type;
    if (parsed.data.priority !== undefined) updateFields.priority = parsed.data.priority;
    if (parsed.data.status !== undefined) {
      updateFields.status = parsed.data.status;
      // Set completedAt when transitioning to completed
      if (parsed.data.status === "completed") {
        updateFields.completedAt = now;
      }
    }
    if (parsed.data.tags !== undefined) updateFields.tags = parsed.data.tags;

    const result = await tasksCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateFields },
      { returnDocument: "after" }
    );

    if (!result) {
      return NextResponse.json(notFound("Task not found").toJson(), { status: 404 });
    }

    return NextResponse.json({ task: result });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/admin/tasks/[id] — Hard-delete a task by ID.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403, 404
/**
 * DELETE /api/admin/tasks/[id]
 * Delete task (hard delete)
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success) {
      return NextResponse.json({ error: "Invalid task ID" }, { status: 400 });
    }

    const db = await getDb();
    const tasksCollection = getTasksCollection(db);

    const result = await tasksCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return NextResponse.json(notFound("Task not found").toJson(), { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
