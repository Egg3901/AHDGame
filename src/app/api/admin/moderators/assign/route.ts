import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { z } from "zod";
import type { User } from "@/lib/db/types";

const assignModSchema = z.object({
  userId: z.string().length(24),
});

// POST /api/admin/moderators/assign — Assign moderator role to a user.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, assignModSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const objectId = new ObjectId(parsed.data.userId);
    const user = await db.collection<User>("users").findOne({ _id: objectId });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.role === "admin") {
      return NextResponse.json(
        { error: "Cannot assign moderator role to an admin" },
        { status: 400 }
      );
    }

    if (user.role === "moderator") {
      return NextResponse.json({ error: "User is already a moderator" }, { status: 400 });
    }

    await db.collection<User>("users").updateOne(
      { _id: objectId },
      {
        $set: {
          role: "moderator",
          moderatorSince: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    await createAdminLog({
      category: "account",
      action: "moderator_assigned",
      username: user.username,
      adminUsername: admin.username,
      details: "Assigned moderator role",
    });

    return NextResponse.json({
      success: true,
      message: `${user.username} is now a moderator`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
