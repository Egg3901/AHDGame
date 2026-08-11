import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";

const modNoteSchema = z.object({
  userId: z.string().length(24),
  note: z.string().max(2000),
});

// PATCH /api/admin/users/mod-note — Set or clear a mod note on a user.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, modNoteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { userId, note } = parsed.data;
    const trimmed = note.trim();
    const db = await getDb();
    const objectId = new ObjectId(userId);

    const user = await db.collection("users").findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (trimmed) {
      await db
        .collection("users")
        .updateOne({ _id: objectId }, { $set: { modNote: trimmed, updatedAt: new Date() } });
    } else {
      await db
        .collection("users")
        .updateOne({ _id: objectId }, { $unset: { modNote: "" }, $set: { updatedAt: new Date() } });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
