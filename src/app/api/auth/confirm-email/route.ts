import { NextResponse } from "next/server";
import { isPlaceholderEmail } from "@/lib/auth/placeholderEmail";
import { authMigrationFenceAbsentFilter } from "@/lib/auth/sourceFence";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import type { User } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { parseJsonBody } from "@/lib/api/validate";
import { confirmEmailChangeSchema } from "@/lib/api/schemas/settings";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { recordAudit } from "@/lib/audit/recordAudit";
import { consumeEmailChange } from "@/lib/emailChange";
import { sendEmail } from "@/lib/email";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };
const INVALID_LINK =
  "This confirmation link is invalid or has expired. Please request a new one from Settings.";

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

// POST /api/auth/confirm-email — Burns a change-email token and moves the account to the confirmed address.
// Auth: public (token-bearing)
// Errors: 400, 409, 429
export async function POST(request: Request) {
  try {
    const clientIp = await getClientIp();
    const limit = await durableRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, confirmEmailChangeSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const change = await consumeEmailChange(parsed.data.token);
    if (!change) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.change_email_confirmed",
        subject: { type: "user" },
        outcome: "rejected",
        reason: "invalid_or_expired_token",
      });
      return errorResponse(400, INVALID_LINK, NO_STORE);
    }

    const db = await getDb();
    const usersCollection = db.collection<User>("users");

    let matched: number;
    try {
      // CAS on the address the request was made from: a second change that
      // landed in between wins, and this stale link does nothing.
      const updated = await usersCollection.updateOne(
        {
          _id: change.userId,
          email: change.previousEmail,
          isBanned: { $ne: true },
          ...authMigrationFenceAbsentFilter(),
        },
        { $set: { email: change.newEmail, emailVerifiedAt: new Date() } }
      );
      matched = updated.matchedCount;
    } catch (error) {
      if (isDuplicateKey(error)) {
        return errorResponse(409, "That email is already used by another account.", NO_STORE);
      }
      throw error;
    }

    if (matched !== 1) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.change_email_confirmed",
        subject: { type: "user", id: change.userId },
        outcome: "rejected",
        reason: "account_changed",
      });
      return errorResponse(400, INVALID_LINK, NO_STORE);
    }

    invalidateCachedUser(change.userId.toHexString());

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.change_email_confirmed",
      subject: { type: "user", id: change.userId },
      outcome: "ok",
    });

    // Tell the old inbox, so a hijacked session cannot move the account silently.
    if (!isPlaceholderEmail(change.previousEmail)) {
      await sendEmail({
        to: change.previousEmail,
        subject: "Your A House Divided email was changed",
        text:
          "The email on your A House Divided account was just changed to a new address.\n\n" +
          "If this was not you, contact support on Discord right away.",
        html:
          "<p>The email on your A House Divided account was just changed to a new address.</p>" +
          "<p>If this was not you, contact support on Discord right away.</p>",
      });
    }

    return NextResponse.json({ ok: true, email: change.newEmail }, NO_STORE);
  } catch (error) {
    return handleRouteError(error);
  }
}
