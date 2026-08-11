import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { getClientIp } from "@/lib/utils/network";
import { checkRateLimit, SUGGESTION_SUBMIT_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createSuggestionSchema } from "@/lib/api/schemas/suggestion";
import { getNextSuggestionNumber } from "@/lib/suggestionCounter";
import { createPlayerSuggestionGitHubIssue } from "@/lib/github";
import { createNotification } from "@/lib/notifications";
import {
  buildPlayerSuggestionDiscordEmbed,
  deliverPlayerSuggestionDiscordEmbed,
  getDiscordSuggestionsWebhookUrl,
  notifyNewSuggestionDiscord,
} from "@/lib/discordWebhooks";
import type { Suggestion, User } from "@/lib/db/types";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";

const DISCORD_SYNC_SPACING_MS = 400;

// PUT /api/suggestions — Admin: post Discord embeds (with feedback link) for suggestions not yet delivered to the suggestions webhook
// Auth: requireAdmin
// Query: `limit` (1–50, default 25) — max suggestions to process this request (run again until `posted` is 0)
// Errors: 400, 403
export async function PUT(request: Request) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const auth = await requireAdmin();
    if (!auth.ok) {
      logRequest("PUT", path, 403, Date.now() - start);
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 25;
    const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 25;

    const webhookUrl = await getDiscordSuggestionsWebhookUrl();
    if (!webhookUrl) {
      logRequest("PUT", path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "Suggestions Discord webhook URL is not configured in game config." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const coll = getSuggestionsCollection(db);
    const pending = await coll
      .find({ discordPostedAt: { $exists: false } })
      .sort({ issueNumber: 1 })
      .limit(limit)
      .toArray();

    if (pending.length === 0) {
      logRequest("PUT", path, 200, Date.now() - start);
      return NextResponse.json({
        posted: 0,
        failed: 0,
        skipped: 0,
        processed: 0,
        remaining: 0,
        message: "Nothing to sync.",
      });
    }

    const userIds = [...new Set(pending.map((s) => s.userId).filter(Boolean))] as ObjectId[];
    const users =
      userIds.length > 0
        ? await db
            .collection<User>("users")
            .find({ _id: { $in: userIds } })
            .project({ username: 1, discordUsername: 1 })
            .toArray()
        : [];
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com").replace(
      /\/$/,
      ""
    );

    let posted = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < pending.length; i++) {
      const s = pending[i]!;
      const uid = s.userId?.toString();
      const u = uid ? userById.get(uid) : undefined;
      const detailUrl = `${baseUrl}/feedback/${s.issueNumber}`;
      const embed = buildPlayerSuggestionDiscordEmbed({
        issueNumber: s.issueNumber,
        category: String(s.category),
        title: s.title,
        description: s.description,
        impact: s.impact,
        priority: s.priority,
        reporterUsername: u?.username ?? null,
        reporterDiscordUsername: u?.discordUsername ?? null,
        discordSubmitDisplayName: s.discordSubmitDisplayName,
        discordSubmitUsername: s.discordSubmitUsername,
        detailUrl,
        githubIssueUrl: s.githubIssueUrl,
        gameSystem: s.gameSystem,
      });

      const { status, messageId } = await deliverPlayerSuggestionDiscordEmbed(embed);
      if (status === "posted") {
        posted++;
        await coll.updateOne(
          { _id: s._id },
          {
            $set: {
              discordPostedAt: new Date(),
              updatedAt: new Date(),
              ...(messageId && { discordMessageId: messageId }),
            },
          }
        );
      } else if (status === "failed") {
        failed++;
      } else {
        skipped++;
      }

      if (i < pending.length - 1) {
        await new Promise((r) => setTimeout(r, DISCORD_SYNC_SPACING_MS));
      }
    }

    const remaining = await coll.countDocuments({ discordPostedAt: { $exists: false } });

    logRequest("PUT", path, 200, Date.now() - start);
    return NextResponse.json({
      posted,
      failed,
      skipped,
      processed: pending.length,
      remaining,
      message:
        posted > 0
          ? `Posted ${posted} embed(s) to Discord. Re-run with PUT until remaining is 0 if needed.`
          : "No embeds posted (check failed count and server logs).",
    });
  } catch (err) {
    logRequest("PUT", path, 500, Date.now() - start);
    return handleRouteError(err);
  }
}

// POST /api/suggestions — Submit a player suggestion (forum); stored only in `suggestions`.
// Auth: public (optional user attribution)
// Errors: 400, 429
export async function POST(request: Request) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const clientIp = await getClientIp();
    const user = await getAuthUser();
    const userId = user?.userId ? new ObjectId(user.userId) : null;
    const rateId = userId ? `suggestion:user:${userId.toString()}` : `suggestion:ip:${clientIp}`;
    const limit = checkRateLimit(
      rateId,
      SUGGESTION_SUBMIT_LIMITS.maxRequests,
      SUGGESTION_SUBMIT_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      const sec = limit.retryAfter ?? SUGGESTION_SUBMIT_LIMITS.windowMs / 1000;
      const minutes = Math.max(1, Math.ceil(sec / 60));
      return rateLimitResponse(
        limit.retryAfter,
        `Suggestions are limited to one post every ${minutes} minute${minutes === 1 ? "" : "s"} to reduce spam. Please try again after the cooldown.`
      );
    }

    const parsed = await parseJsonBody(request, createSuggestionSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    const now = new Date();
    const issueNumber = await getNextSuggestionNumber();

    const doc: Omit<Suggestion, "_id"> = {
      issueNumber,
      userId,
      category: body.category,
      gameSystem: body.gameSystem,
      title: String(body.title).trim().slice(0, 200),
      description: String(body.description).trim().slice(0, 5000),
      context: {
        pathname: body.context?.pathname ?? "",
        url: body.context?.url ?? "",
        capturedAt: body.context?.capturedAt ?? now.toISOString(),
        lastAction:
          typeof body.context?.lastAction === "object" && body.context?.lastAction !== null
            ? body.context.lastAction
            : undefined,
        recentActions: Array.isArray(body.context?.recentActions)
          ? body.context.recentActions.filter(
              (a): a is { label: string; timestamp: string; metadata?: Record<string, unknown> } =>
                typeof a === "object" && a !== null && "label" in a && "timestamp" in a
            )
          : [],
        userAgent: body.context?.userAgent ?? "",
        viewport: body.context?.viewport ?? { width: 0, height: 0 },
        referrer: body.context?.referrer,
      },
      commentCount: 0,
      status: "not_reviewed",
      screenshotUrl: body.screenshotUrl ?? undefined,
      impact: body.impact != null ? String(body.impact).trim().slice(0, 500) : undefined,
      priority: body.priority != null ? Math.max(1, Math.min(5, Number(body.priority))) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const db = await getDb();
    const coll = getSuggestionsCollection(db);
    const result = await coll.insertOne(doc as Suggestion);

    let githubIssueUrl: string | undefined;
    if (process.env.GIT_TOKEN && process.env.GITHUB_REPO) {
      const reporterUsername = userId
        ? (
            await db
              .collection<User>("users")
              .findOne({ _id: userId }, { projection: { username: 1 } })
          )?.username
        : null;
      const gh = await createPlayerSuggestionGitHubIssue({
        issueNumber,
        title: doc.title,
        description: doc.description,
        category: doc.category,
        gameSystem: doc.gameSystem,
        impact: doc.impact,
        priority: doc.priority,
        context: doc.context,
        reporterUsername,
        screenshotUrl: doc.screenshotUrl,
      });
      if (gh) {
        githubIssueUrl = gh.url;
        await coll.updateOne(
          { _id: result.insertedId },
          { $set: { githubIssueUrl: gh.url, githubIssueNumber: gh.number } }
        );
      }
    }

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com").replace(
      /\/$/,
      ""
    );
    const suggestionDetailUrl = `${baseUrl}/feedback/${issueNumber}`;
    let reporterDiscordUsername: string | null = null;
    if (userId) {
      reporterDiscordUsername =
        (
          await db
            .collection<User>("users")
            .findOne({ _id: userId }, { projection: { discordUsername: 1 } })
        )?.discordUsername ?? null;
    }
    const { status: discordStatus, messageId: discordMsgId } = await notifyNewSuggestionDiscord({
      issueNumber,
      category: String(doc.category),
      title: doc.title,
      description: doc.description,
      impact: doc.impact,
      priority: doc.priority,
      reporterUsername: user?.username ?? null,
      reporterDiscordUsername,
      discordSubmitDisplayName: doc.discordSubmitDisplayName,
      discordSubmitUsername: doc.discordSubmitUsername,
      detailUrl: suggestionDetailUrl,
      githubIssueUrl,
      gameSystem: doc.gameSystem,
    });
    if (discordStatus === "posted") {
      await coll.updateOne(
        { _id: result.insertedId },
        {
          $set: {
            discordPostedAt: new Date(),
            updatedAt: new Date(),
            ...(discordMsgId && { discordMessageId: discordMsgId }),
          },
        }
      );
    }

    try {
      const admins = await db
        .collection<User>("users")
        .find({ $or: [{ role: "admin" }, { isAdmin: true }] })
        .project({ _id: 1 })
        .toArray();

      const reporterLabel = user?.username ? `@${user.username}` : "Anonymous";
      await Promise.allSettled(
        admins.map((admin) =>
          createNotification({
            userId: admin._id,
            type: "new_player_suggestion",
            title: `New suggestion S#${issueNumber}`,
            message: `${reporterLabel}: "${doc.title.slice(0, 100)}"`,
            metadata: {
              suggestionIssueNumber: issueNumber,
              suggestionId: result.insertedId.toString(),
              category: doc.category,
              gameSystem: doc.gameSystem,
              reporterUsername: user?.username ?? null,
            },
          })
        )
      );
    } catch {
      // non-fatal
    }

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({
      id: result.insertedId.toString(),
      issueNumber,
      githubIssueUrl: githubIssueUrl ?? undefined,
      message: "Suggestion submitted. Thank you!",
    });
  } catch (err) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(err);
  }
}
