import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authRevocationSnapshotFilter } from "@/lib/auth/sessionIssue";
import { authMigrationFenceAbsentFilter, isAuthMigrationFenced } from "@/lib/auth/sourceFence";
import type { User } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { parseJsonBody } from "@/lib/api/validate";
import { resetPasswordBodySchema } from "@/lib/api/schemas/auth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { recordAudit } from "@/lib/audit/recordAudit";
import { consumePasswordReset } from "@/lib/passwordReset";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";

// POST /api/auth/reset-password - Sets a new password using a single-use reset token from forgot-password.
// Auth: public (token-bearing)
// Errors: 400, 429
export async function POST(request: Request) {
  try {
    const clientIp = await getClientIp();
    const limit = await durableRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, resetPasswordBodySchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { token, password } = parsed.data;

    const reset = await consumePasswordReset(token);
    if (!reset) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.reset_password",
        subject: { type: "user" },
        outcome: "rejected",
        reason: "invalid_or_expired_token",
      });
      return errorResponse(
        400,
        "This reset link is invalid or has expired. Please request a new one."
      );
    }

    const db = await getDb();
    const user = await db.collection<User>("users").findOne({ _id: reset.userId });
    // Fenced accounts never consume a reset token via legacy reset. Same
    // generic 400 body as an expired token so fenced is not an oracle.
    if (user && isAuthMigrationFenced(user)) {
      return errorResponse(
        400,
        "This reset link is invalid or has expired. Please request a new one.",
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (
      !user ||
      !(reset.createdAt instanceof Date) ||
      !Number.isFinite(reset.createdAt.getTime()) ||
      (user.passwordChangedAt != null &&
        (!(user.passwordChangedAt instanceof Date) ||
          !Number.isFinite(user.passwordChangedAt.getTime()) ||
          user.passwordChangedAt >= reset.createdAt))
    ) {
      return errorResponse(
        400,
        "This reset link is invalid or has expired. Please request a new one.",
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const changedAt = new Date();
    // Update password in database and invalidate all existing sessions
    const updated = await db.collection<User>("users").updateOne(
      {
        _id: reset.userId,
        password: user.password ?? null,
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
      return errorResponse(
        409,
        "Your account changed during this request. Please sign in and try again.",
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Token revocation must bite immediately, not after the userDocCache TTL.
    invalidateCachedUser(reset.userId.toString());

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.reset_password",
      subject: { type: "user", id: reset.userId },
      outcome: "ok",
    });

    return NextResponse.json({ message: "Password reset successfully" });
  } catch (error) {
    return handleRouteError(error);
  }
}
