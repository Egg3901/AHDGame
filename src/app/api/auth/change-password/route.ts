import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { verifyAuth } from "@/lib/auth";
import { credentialSessionIsCurrent } from "@/lib/auth/credentialSession";
import { authRevocationSnapshotFilter } from "@/lib/auth/sessionIssue";
import { authMigrationFenceAbsentFilter } from "@/lib/auth/sourceFence";
import type { User } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { changePasswordSchema } from "@/lib/api/schemas/settings";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";

// POST /api/auth/change-password — Changes the authenticated user's password after verifying the current one.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = auth.user.userId;

    const rateLimit = checkRateLimit(userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, changePasswordSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { currentPassword, newPassword } = parsed.data;

    const db = await getDb();
    const usersCollection = db.collection<User>("users");

    // Get user from database
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Credential changes require the uncached account state read above.
    if (!credentialSessionIsCurrent(userId, user, await verifyAuth())) {
      return NextResponse.json(
        { error: "Please sign in again before changing your password." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);

    if (!isValidPassword) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const changedAt = new Date();

    // Update password in database — also invalidate all existing sessions
    const updated = await usersCollection.updateOne(
      {
        _id: new ObjectId(userId),
        password: user.password ?? null,
        isBanned: { $ne: true },
        ...authRevocationSnapshotFilter(user.authRevokedAt),
        ...authMigrationFenceAbsentFilter(),
      },
      {
        $set: {
          password: hashedPassword,
        },
        $max: { passwordChangedAt: changedAt, authRevokedAt: changedAt },
      }
    );

    if (updated.matchedCount !== 1) {
      return NextResponse.json(
        { error: "Your account changed during this request. Please sign in and try again." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Token revocation must bite immediately, not after the userDocCache TTL.
    invalidateCachedUser(userId);

    return NextResponse.json({
      message: "Password changed successfully",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
