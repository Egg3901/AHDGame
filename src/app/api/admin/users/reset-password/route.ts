import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { authRevocationSnapshotFilter } from "@/lib/auth/sessionIssue";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import type { User } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { withNoStore } from "@/lib/api/withNoStore";
import { createAdminLog } from "@/lib/adminLog";
import { parseJsonBody } from "@/lib/api/validate";
import { adminResetPasswordSchema } from "@/lib/api/schemas/admin";

// POST /api/admin/users/reset-password — Reset a user's password to a new value.
// Auth: requireAdmin
// Errors: 400, 403, 404, 409, 503
export const POST = withNoStore(async (request: Request) => {
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
    const usersCollection = db.collection<User>("users");

    // Check if user exists
    const user = await usersCollection.findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const now = new Date();

    // Remove this process's cached account before starting the write.
    invalidateCachedUser(objectId.toHexString());

    // Serialize against a concurrent credential or revocation change. A banned
    // target stays repairable: ban state is not part of the snapshot and this
    // write never alters it.
    let updated;
    try {
      updated = await usersCollection.updateOne(
        {
          _id: objectId,
          password: user.password ?? null,
          ...authRevocationSnapshotFilter(user.authRevokedAt),
        },
        {
          $set: {
            password: hashedPassword,
            updatedAt: now,
          },
          $max: { passwordChangedAt: now, authRevokedAt: now },
        }
      );
    } catch {
      return NextResponse.json(
        { error: "Password reset is temporarily unavailable. Please try again." },
        { status: 503 }
      );
    } finally {
      // A lost acknowledgment may still mean the write committed. Remove any
      // cached account again on every settled write, including failure.
      invalidateCachedUser(objectId.toHexString());
    }

    if (updated.acknowledged !== true) {
      return NextResponse.json(
        { error: "Password reset is temporarily unavailable. Please try again." },
        { status: 503 }
      );
    }

    if (updated.matchedCount !== 1) {
      return NextResponse.json(
        { error: "This account changed during this request. Please reload and try again." },
        { status: 409 }
      );
    }

    // Post-commit lookups and audit are best effort: the credential is already
    // rotated, so they must not convert success into a retryable failure.
    // Never log the secret.
    let characterName: string | undefined;
    try {
      const character = await db.collection("characters").findOne({ userId: objectId });
      characterName = character?.name;
    } catch {
      characterName = undefined;
    }
    try {
      await createAdminLog({
        category: "account",
        action: "password_reset",
        username: user.username,
        characterName,
        adminUsername: admin.username,
      });
    } catch {
      // Best effort; the password change already committed.
    }

    return NextResponse.json({
      success: true,
      message: `Password reset successfully for user: ${user.username}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
