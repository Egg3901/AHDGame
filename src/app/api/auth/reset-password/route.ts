import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";
import { getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { parseJsonBody } from "@/lib/api/validate";
import { resetPasswordBodySchema } from "@/lib/api/schemas/auth";
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
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
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Please request a new one." },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const db = await getDb();
    // Update password in database and invalidate all existing sessions
    await db.collection("users").updateOne(
      { _id: reset.userId },
      {
        $set: {
          password: hashedPassword,
          passwordChangedAt: new Date(),
          authRevokedAt: new Date(),
        },
      }
    );

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
