import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { createAdminLog } from "@/lib/adminLog";
import { parseJsonBody } from "@/lib/api/validate";
import { adminResetPasswordSchema } from "@/lib/api/schemas/admin";

// POST /api/admin/users/reset-password — Reset a user's password to a new value.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminResetPasswordSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { userId, newPassword } = parsed.data;
    const objectId = new ObjectId(userId);

    const db = await getDb();
    const usersCollection = db.collection("users");

    // Check if user exists
    const user = await usersCollection.findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update the password
    await usersCollection.updateOne(
      { _id: objectId },
      {
        $set: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
      }
    );

    // Get character name for logging
    const character = await db.collection("characters").findOne({ userId: objectId });

    // Log the password reset
    await createAdminLog({
      category: "account",
      action: "password_reset",
      username: user.username,
      characterName: character?.name,
      adminUsername: admin.username,
    });

    return NextResponse.json({
      success: true,
      message: `Password reset successfully for user: ${user.username}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
