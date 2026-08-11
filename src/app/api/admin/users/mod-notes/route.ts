import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { User, ModNote } from "@/lib/db/types";

const addNoteSchema = z.object({
  userId: z.string().length(24),
  text: z.string().min(1).max(2000),
});

// POST /api/admin/users/mod-notes — Add a structured mod note as admin.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, addNoteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { userId, text } = parsed.data;
    const db = await getDb();
    const objectId = new ObjectId(userId);

    const user = await db.collection<User>("users").findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Migrate legacy modNote string to structured modNotes array if present
    if (user.modNote && (!user.modNotes || user.modNotes.length === 0)) {
      const legacyNote: ModNote = {
        authorId: new ObjectId(admin.userId),
        authorName: "System (migrated)",
        authorRole: "admin",
        text: user.modNote,
        createdAt: user.updatedAt ?? new Date(),
      };
      await db
        .collection<User>("users")
        .updateOne(
          { _id: objectId },
          { $set: { modNotes: [legacyNote] }, $unset: { modNote: "" } }
        );
    }

    const note: ModNote = {
      authorId: new ObjectId(admin.userId),
      authorName: admin.username,
      authorRole: "admin",
      text: text.trim(),
      createdAt: new Date(),
    };

    await db.collection<User>("users").updateOne(
      { _id: objectId },
      {
        $push: { modNotes: note } as Record<string, unknown>,
        $set: { updatedAt: new Date() },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
