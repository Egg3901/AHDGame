import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getTaskLessonsCollection } from "@/lib/db/collections/taskLessons";
import { getDb } from "@/lib/mongodb";
import { z } from "zod";

const patchLessonSchema = z.object({
  tags: z
    .array(z.string().trim().min(1).max(30))
    .max(20)
    .transform((arr) => [...new Set(arr)])
    .optional(),
  category: z.enum(["bug", "design", "process", "technical", "general"]).optional(),
});

// PATCH /api/admin/tasks/lessons/[id] — Update tags and/or category on a lesson.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403, 404
/**
 * PATCH /api/admin/tasks/lessons/[id]
 * Update tags and/or category on a lesson.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const parsed = await parseJsonBody(request, patchLessonSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const col = getTaskLessonsCollection(db);

    const update: Record<string, unknown> = {};
    if (parsed.data.tags !== undefined) update.tags = parsed.data.tags;
    if (parsed.data.category !== undefined) update.category = parsed.data.category;

    if (Object.keys(update).length === 0)
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const result = await col.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: update },
      { returnDocument: "after" }
    );

    if (!result) return NextResponse.json(notFound("lesson").toJson(), { status: 404 });

    return NextResponse.json({ lesson: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
