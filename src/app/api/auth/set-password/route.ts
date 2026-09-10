import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { verifyAuth } from "@/lib/auth";
import { credentialSessionIsCurrent } from "@/lib/auth/credentialSession";
import { authRevocationSnapshotFilter } from "@/lib/auth/sessionIssue";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import type { User } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { setPasswordSchema } from "@/lib/api/schemas/settings";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

// POST /api/auth/set-password — Sets a password for a social-only account that has no existing password.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = auth.user.userId;

    const rateLimit = checkRateLimit(userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, setPasswordSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { newPassword } = parsed.data;

    const db = await getDb();
    const usersCollection = db.collection<User>("users");

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

    // Only allow setting password if user doesn't have one (social-only accounts)
    if (user.password) {
      return NextResponse.json(
        { error: "Password already set. Use change password instead." },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const changedAt = new Date();

    const updated = await usersCollection.updateOne(
      {
        _id: new ObjectId(userId),
        password: user.password ?? null,
        isBanned: { $ne: true },
        ...authRevocationSnapshotFilter(user.authRevokedAt),
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

    invalidateCachedUser(userId);
    return NextResponse.json({ message: "Password set successfully" });
  } catch (error) {
    return handleRouteError(error);
  }
}
