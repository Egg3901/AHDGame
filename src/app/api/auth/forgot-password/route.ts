import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { parseJsonBody } from "@/lib/api/validate";
import { forgotPasswordBodySchema } from "@/lib/api/schemas/auth";
import { handleRouteError } from "@/lib/api/errors";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { recordAudit } from "@/lib/audit/recordAudit";
import { createPasswordReset, PASSWORD_RESETS_COLLECTION } from "@/lib/passwordReset";
import type { PasswordResetDoc } from "@/lib/passwordReset";
import { sendEmail } from "@/lib/email";
import type { User } from "@/lib/db/types";

/** Per-identifier limit: 3 requests per 15 minutes. Deliberately tighter than
 * the per-IP AUTH_LIMITS so one target account cannot be spammed with links. */
const IDENTIFIER_LIMITS = { maxRequests: 3, windowMs: 15 * 60 * 1000 };

// The generic success body returned on every non-429 path so the response
// never reveals whether the identifier matched an account.
const GENERIC_OK = { ok: true } as const;

function resetEmailContent(url: string): { html: string; text: string } {
  const text =
    "We received a request to reset your A House Divided password.\n\n" +
    `Reset it here: ${url}\n\n` +
    "This link lasts 30 minutes. If you did not request this, you can ignore this email and your password will stay the same.";
  const html =
    "<p>We received a request to reset your A House Divided password.</p>" +
    `<p><a href="${url}">Reset your password</a></p>` +
    "<p>This link lasts 30 minutes. If you did not request this, you can ignore this email and your password will stay the same.</p>";
  return { html, text };
}

// POST /api/auth/forgot-password - Requests a password reset link by email or username. Always returns a generic 200.
// Auth: public
// Errors: 400, 429
export async function POST(request: Request) {
  try {
    const clientIp = await getClientIp();
    const ipLimit = await durableRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
    if (!ipLimit.ok) return rateLimitResponse(ipLimit.retryAfter);

    const parsed = await parseJsonBody(request, forgotPasswordBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const identifier = parsed.data.identifier.toLowerCase().trim();

    const idLimit = await durableRateLimit(
      `forgot-password:${identifier}`,
      IDENTIFIER_LIMITS.maxRequests,
      IDENTIFIER_LIMITS.windowMs
    );
    if (!idLimit.ok) return rateLimitResponse(idLimit.retryAfter);

    const turnstile = await verifyTurnstileToken(parsed.data.turnstileToken, clientIp);
    if (!turnstile.ok) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.forgot_password",
        subject: { type: "user", name: identifier },
        outcome: "rejected",
        reason: "turnstile_failed",
      });
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const user = await db.collection<User>("users").findOne({
      $or: [{ email: identifier }, { username: identifier }],
    });

    if (!user) {
      recordAudit({
        source: "api",
        category: "auth",
        action: "auth.forgot_password",
        subject: { type: "user", name: identifier },
        outcome: "rejected",
        reason: "user_not_found",
      });
      // Same body as the success path: no account enumeration.
      return NextResponse.json(GENERIC_OK);
    }

    // OAuth-only accounts (no password field) are allowed through: completing
    // the reset simply sets a first password on the account.
    const { rawToken, doc } = await createPasswordReset(user._id);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
    const url = `${baseUrl}/reset-password?token=${rawToken}`;

    let emailed = false;
    if (user.email) {
      const { html, text } = resetEmailContent(url);
      const result = await sendEmail({
        to: user.email,
        subject: "Reset your A House Divided password",
        html,
        text,
      });
      emailed = result.sent;
    }

    let queuedDiscord = false;
    if (user.discordId) {
      await db.collection<PasswordResetDoc>(PASSWORD_RESETS_COLLECTION).updateOne(
        { _id: doc._id },
        {
          $set: {
            discordDelivery: {
              discordId: user.discordId,
              url,
              queuedAt: new Date(),
              deliveredAt: null,
            },
          },
        }
      );
      queuedDiscord = true;
    }

    recordAudit({
      source: "api",
      category: "auth",
      action: "auth.forgot_password",
      subject: { type: "user", id: user._id, name: user.username },
      outcome: "ok",
      reason:
        emailed && queuedDiscord
          ? "email_and_discord"
          : emailed
            ? "email"
            : queuedDiscord
              ? "discord"
              : "no_delivery_channel",
    });

    return NextResponse.json(GENERIC_OK);
  } catch (error) {
    return handleRouteError(error);
  }
}
