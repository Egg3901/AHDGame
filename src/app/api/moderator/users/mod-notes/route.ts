import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { createModAuditLog } from "@/lib/modAuditLog";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { User, ModNote } from "@/lib/db/types";

const addNoteSchema = z.object({
  userId: z.string().length(24),
  text: z.string().min(1).max(2000),
});

// POST /api/moderator/users/mod-notes — Add a structured mod note to a user.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, addNoteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { userId, text } = parsed.data;
    const db = await getDb();
    const objectId = new ObjectId(userId);

    const targetUser = await db.collection<User>("users").findOne({ _id: objectId });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.role === "admin") {
      return NextResponse.json(
        { error: "Cannot perform actions on admin accounts" },
        { status: 403 }
      );
    }

    // Migrate legacy modNote string to structured modNotes array if present
    if (targetUser.modNote && (!targetUser.modNotes || targetUser.modNotes.length === 0)) {
      const legacyNote: ModNote = {
        authorId: new ObjectId(moderator.userId),
        authorName: "System (migrated)",
        authorRole: moderator.isAdmin ? "admin" : "moderator",
        text: targetUser.modNote,
        createdAt: targetUser.updatedAt ?? new Date(),
      };
      await db
        .collection<User>("users")
        .updateOne(
          { _id: objectId },
          { $set: { modNotes: [legacyNote] }, $unset: { modNote: "" } }
        );
    }

    const note: ModNote = {
      authorId: new ObjectId(moderator.userId),
      authorName: moderator.username,
      authorRole: moderator.isAdmin ? "admin" : "moderator",
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

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "add_mod_note",
      targetUserId: userId,
      targetUsername: targetUser.username,
      details: text.trim().slice(0, 200),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
