import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser()
import { getClientIp } from "@/lib/utils/network";
import { checkRateLimit, FEEDBACK_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { feedbackSchema } from "@/lib/api/schemas/feedback";
import { getNextFeedbackNumber } from "@/lib/feedbackCounter";
import { createGitHubIssue } from "@/lib/github";
import { createNotification } from "@/lib/notifications";
import type { Feedback, FeedbackType, BugCategory, SuggestionCategory } from "@/lib/db/types";
import type { User } from "@/lib/db/types";

/**
 * POST /api/feedback
 * Submit a bug report or suggestion.

 * Body: { type, category, title, description, stepsToReproduce?, severity?, impact?, priority?, context }
 */
// POST /api/feedback — Submit a bug report or suggestion, optionally attributed to the logged-in user.
// Auth: public
// Errors: 400, 429
export async function POST(request: Request) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const clientIp = await getClientIp();
    const limit = checkRateLimit(clientIp, FEEDBACK_LIMITS.maxRequests, FEEDBACK_LIMITS.windowMs);
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const user = await getAuthUser();
    const userId = user?.userId ? new ObjectId(user.userId) : null;

    const parsed = await parseJsonBody(request, feedbackSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;
    const { type, category, title, description, context } = body;
    const screenshotUrl = (body as { screenshotUrl?: string }).screenshotUrl;
    const sentryEventId = (body as { sentryEventId?: string }).sentryEventId;

    const now = new Date();
    const issueNumber = await getNextFeedbackNumber();

    const doc: Omit<Feedback, "_id"> = {
      issueNumber,
      userId,
      type: type as FeedbackType,
      category: category as BugCategory | SuggestionCategory,
      title: String(title).trim().slice(0, 200),
      description: String(description).trim().slice(0, 5000),
      context: {
        pathname: context?.pathname ?? "",
        url: context?.url ?? "",
        capturedAt: context?.capturedAt ?? now.toISOString(),
        lastAction:
          typeof context?.lastAction === "object" && context?.lastAction !== null
            ? context.lastAction
            : undefined,
        recentActions: Array.isArray(context?.recentActions)
          ? context.recentActions.filter(
              (a): a is { label: string; timestamp: string; metadata?: Record<string, unknown> } =>
                typeof a === "object" && a !== null && "label" in a && "timestamp" in a
            )
          : [],
        userAgent: context?.userAgent ?? "",
        viewport: context?.viewport ?? { width: 0, height: 0 },
        referrer: context?.referrer,
      },
      status: "open",
      screenshotUrl: screenshotUrl ?? undefined,
      sentryEventId: sentryEventId ?? undefined,
      createdAt: now,
      updatedAt: now,
    };

    if (type === "bug") {
      const bugBody = body as { stepsToReproduce?: string; severity?: number };
      doc.stepsToReproduce =
        bugBody.stepsToReproduce != null
          ? String(bugBody.stepsToReproduce).trim().slice(0, 2000)
          : undefined;
      doc.severity =
        bugBody.severity != null ? Math.max(1, Math.min(5, Number(bugBody.severity))) : undefined;
    }

    if (type === "suggestion") {
      const suggBody = body as { impact?: string; priority?: number | string };
      doc.impact =
        suggBody.impact != null ? String(suggBody.impact).trim().slice(0, 500) : undefined;
      doc.priority =
        suggBody.priority != null ? Math.max(1, Math.min(5, Number(suggBody.priority))) : undefined;
    }

    const db = await getDb();
    const result = await db.collection<Feedback>("feedback").insertOne(doc as Feedback);

    // Create GitHub issue if GIT_TOKEN and GITHUB_REPO are configured
    let githubIssueUrl: string | undefined;
    if (process.env.GIT_TOKEN && process.env.GITHUB_REPO) {
      const reporterUsername = userId
        ? (
            await db
              .collection<User>("users")
              .findOne({ _id: userId }, { projection: { username: 1 } })
          )?.username
        : null;
      const gh = await createGitHubIssue({
        issueNumber,
        type: type as "bug" | "suggestion",
        title: doc.title,
        description: doc.description,
        category: doc.category,
        stepsToReproduce: doc.stepsToReproduce,
        severity: doc.severity,
        impact: doc.impact,
        priority: doc.priority,
        context: doc.context,
        reporterUsername,
        screenshotUrl: doc.screenshotUrl,
      });
      if (gh) {
        githubIssueUrl = gh.url;
        await db
          .collection<Feedback>("feedback")
          .updateOne(
            { _id: result.insertedId },
            { $set: { githubIssueUrl: gh.url, githubIssueNumber: gh.number } }
          );
      }
    }

    // Notify all admins of the new submission (best-effort, non-blocking)
    try {
      const admins = await db
        .collection<User>("users")
        .find({ $or: [{ role: "admin" }, { isAdmin: true }] })
        .project({ _id: 1 })
        .toArray();

      const reporterLabel = user?.username ? `@${user.username}` : "Anonymous";
      const typeLabel = type === "bug" ? "bug report" : "suggestion";
      const notifTitle = `New ${typeLabel} #${issueNumber}`;
      const notifMessage = `${reporterLabel} submitted: "${doc.title.slice(0, 100)}"`;

      await Promise.allSettled(
        admins.map((admin) =>
          createNotification({
            userId: admin._id,
            type: "new_feedback",
            title: notifTitle,
            message: notifMessage,
            metadata: {
              issueNumber,
              feedbackType: type,
              category: doc.category,
              reporterUsername: user?.username ?? null,
            },
          })
        )
      );
    } catch {
      // Non-fatal — don't fail the response
    }

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({
      id: result.insertedId.toString(),
      issueNumber,
      githubIssueUrl: githubIssueUrl ?? undefined,
      message:
        type === "bug" ? "Bug report submitted. Thank you!" : "Suggestion submitted. Thank you!",
    });
  } catch (err) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(err);
  }
}
