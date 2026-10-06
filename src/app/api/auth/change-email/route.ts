import { NextResponse } from "next/server";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { verifyAuth } from "@/lib/auth";
import { credentialSessionIsCurrent } from "@/lib/auth/credentialSession";
import { isPlaceholderEmail } from "@/lib/auth/placeholderEmail";
import type { User } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { changeEmailSchema } from "@/lib/api/schemas/settings";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { recordAudit } from "@/lib/audit/recordAudit";
import { createEmailChange } from "@/lib/emailChange";
import { sendEmail } from "@/lib/email";

/** Per-account mail limit: 3 links per hour, so the route cannot be used to spam an inbox. */
const SEND_LIMITS = { maxRequests: 3, windowMs: 60 * 60 * 1000 };
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

function confirmEmailContent(url: string): { html: string; text: string } {
  const text =
    "Someone asked to use this address for an A House Divided account.\n\n" +
    `Confirm it here: ${url}\n\n` +
    "This link lasts 1 hour. If you did not ask for this, ignore this email and nothing will change.";
  const html =
    "<p>Someone asked to use this address for an A House Divided account.</p>" +
    `<p><a href="${url}">Confirm this email address</a></p>` +
    "<p>This link lasts 1 hour. If you did not ask for this, ignore this email and nothing will change.</p>";
  return { html, text };
}

// POST /api/auth/change-email — Mails a confirmation link to a new address. The account email changes only when the link is used.
// Auth: requireBasicAuth (plus current password when the account has one)
// Errors: 400, 401, 404, 409, 429, 503
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = auth.user.userId;

    const rateLimit = checkRateLimit(userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, changeEmailSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { email: newEmail, currentPassword } = parsed.data;

    if (isPlaceholderEmail(newEmail)) {
      return errorResponse(400, "Please enter an email address that can receive mail.");
    }

    const db = await getDb();
    const usersCollection = db.collection<User>("users");
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return errorResponse(404, "User not found");
    }

    if (!credentialSessionIsCurrent(userId, user, await verifyAuth())) {
      return errorResponse(401, "Please sign in again before changing your email.", NO_STORE);
    }

    if (user.password) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
        return errorResponse(401, "Current password is incorrect");
      }
    }

    if (user.email?.toLowerCase() === newEmail) {
      return errorResponse(400, "That is already the email on your account.");
    }

    const taken = await usersCollection.findOne(
      { email: newEmail, _id: { $ne: user._id } },
      { projection: { _id: 1 } }
    );
    if (taken) {
      return errorResponse(409, "That email is already used by another account.");
    }

    const sendLimit = await durableRateLimit(
      `change-email:${userId}`,
      SEND_LIMITS.maxRequests,
      SEND_LIMITS.windowMs
    );
    if (!sendLimit.ok) return rateLimitResponse(sendLimit.retryAfter);

    const { rawToken } = await createEmailChange(user._id, user.email, newEmail);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
    const url = `${baseUrl}/confirm-email?token=${rawToken}`;
    const { html, text } = confirmEmailContent(url);
    const result = await sendEmail({
      to: newEmail,
      subject: "Confirm your A House Divided email",
      html,
      text,
    });

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.change_email_requested",
      subject: { type: "user", id: user._id, name: user.username },
      outcome: result.sent ? "ok" : "rejected",
      reason: result.sent ? undefined : result.reason,
    });

    if (!result.sent) {
      return errorResponse(
        503,
        "We could not send the confirmation email. Please try again later."
      );
    }

    return NextResponse.json({ ok: true, sentTo: newEmail }, NO_STORE);
  } catch (error) {
    return handleRouteError(error);
  }
}
