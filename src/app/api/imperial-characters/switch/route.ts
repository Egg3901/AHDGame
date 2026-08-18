import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import type { User } from "@/lib/db/types/user";

const switchSchema = z.object({
  type: z.enum(["character", "imperial"]),
});

/**
 * POST /api/imperial-characters/switch — Switch between character and imperial mode.
 * Auth: requireAdmin() — admin only.
 * Errors: 400 (no imperial character), 403 (not admin).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, switchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { type } = parsed.data;
    const db = await getDb();
    const adminUserId = new ObjectId(auth.admin.userId);

    if (type === "imperial") {
      // Verify the admin has an imperial character
      const user = await db.collection<User>("users").findOne({ _id: adminUserId });
      if (!user?.activeImperialCharacterId) {
        return NextResponse.json(
          { error: "No imperial character found for this account" },
          { status: 400 }
        );
      }
    }

    await db
      .collection<User>("users")
      .updateOne(
        { _id: adminUserId },
        { $set: { activeCharacterType: type, updatedAt: new Date() } }
      );

    return NextResponse.json({ success: true, activeCharacterType: type });
  } catch (error) {
    return handleRouteError(error);
  }
}
