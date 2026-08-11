import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { getNextSuggestionNumber } from "@/lib/suggestionCounter";
import { createPlayerSuggestionGitHubIssue } from "@/lib/github";
import { createNotification } from "@/lib/notifications";
import { notifyNewSuggestionDiscord } from "@/lib/discordWebhooks";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import type { Suggestion, User } from "@/lib/db/types";
import type { SuggestionCategory, SuggestionGameSystem } from "@/lib/db/types/suggestion";

const schema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  category: z.enum([
    "feature_request",
    "ui_improvement",
    "game_balance",
    "new_content",
    "accessibility",
    "other",
  ]),
  gameSystem: z.enum([
    "elections",
    "legislature",
    "executive",
    "judiciary",
    "economy",
    "corporations",
    "parties",
    "npps",
    "map_geo",
    "combat_or_military",
    "diplomacy",
    "onboarding_account",
    "notifications",
    "meta_other",
  ]),
  impact: z.string().max(500).optional(),
  priority: z.number().min(1).max(5).optional(),
  /** Discord user ID of the submitter — used to attribute suggestion to a linked game account. */
  discordUserId: z.string().optional(),
  /** Discord display name — stored as reporter label when no linked account exists. */
  discordUsername: z.string().optional(),
  /** Discord global display name (from the bot) — shown in-game and on webhook embeds when unlinked. */
  discordDisplayName: z.string().max(128).optional(),
});

// POST /api/discord-bot/suggestions — Submit a suggestion from Discord (/suggest command).
// Auth: requireBotToken (private key only)
// Works for both linked players and unregistered Discord users.
// Errors: 400, 401, 429
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;

    // Rate-limit per Discord user (or by a fallback key if no discordUserId)
    const rateKey = body.discordUserId
      ? `discord-suggest:${body.discordUserId}`
      : "discord-suggest:anon";
    const rateLimit = checkRateLimit(rateKey, 1, 5 * 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const coll = getSuggestionsCollection(db);

    // Resolve linked game account (if any)
    let userId: ObjectId | null = null;
    let reporterUsername: string | null = null;
    let reporterDiscordUsername: string | null = body.discordUsername ?? null;

    if (body.discordUserId) {
      const user = await db
        .collection<User>("users")
        .findOne(
          { discordId: body.discordUserId },
          { projection: { _id: 1, username: 1, discordUsername: 1 } }
        );
      if (user) {
        userId = user._id;
        reporterUsername = user.username ?? null;
        reporterDiscordUsername = user.discordUsername ?? body.discordUsername ?? null;
      }
    }

    const now = new Date();
    const issueNumber = await getNextSuggestionNumber();
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com").replace(
      /\/$/,
      ""
    );
    const detailUrl = `${baseUrl}/feedback/${issueNumber}`;

    const doc: Omit<Suggestion, "_id"> = {
      issueNumber,
      userId,
      ...(body.discordUserId
        ? {
            discordSubmitUserId: body.discordUserId,
            ...(body.discordUsername?.trim()
              ? { discordSubmitUsername: body.discordUsername.trim().slice(0, 64) }
              : {}),
            ...(body.discordDisplayName?.trim()
              ? { discordSubmitDisplayName: body.discordDisplayName.trim().slice(0, 128) }
              : {}),
          }
        : {}),
      category: body.category as SuggestionCategory,
      gameSystem: body.gameSystem as SuggestionGameSystem,
      title: body.title.trim().slice(0, 200),
      description: body.description.trim().slice(0, 5000),
      impact: body.impact?.trim().slice(0, 500),
      priority: body.priority,
      commentCount: 0,
      context: {
        pathname: "/discord",
        url: detailUrl,
        capturedAt: now.toISOString(),
        recentActions: [],
        userAgent: "discord-bot",
        viewport: { width: 0, height: 0 },
      },
      status: "not_reviewed",
      createdAt: now,
      updatedAt: now,
    };

    const result = await coll.insertOne(doc as Suggestion);

    // GitHub issue (non-fatal)
    let githubIssueUrl: string | undefined;
    if (process.env.GIT_TOKEN && process.env.GITHUB_REPO) {
      try {
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
          reporterDiscordSubmit:
            !reporterUsername && reporterDiscordUsername ? reporterDiscordUsername : undefined,
          screenshotUrl: undefined,
        });
        if (gh) {
          githubIssueUrl = gh.url;
          await coll.updateOne(
            { _id: result.insertedId },
            { $set: { githubIssueUrl: gh.url, githubIssueNumber: gh.number } }
          );
        }
      } catch {
        /* non-fatal */
      }
    }

    // Discord webhook post (non-fatal)
    try {
      const { status: discordStatus, messageId: discordMsgId } = await notifyNewSuggestionDiscord({
        issueNumber,
        category: String(doc.category),
        title: doc.title,
        description: doc.description,
        impact: doc.impact,
        priority: doc.priority,
        reporterUsername,
        reporterDiscordUsername,
        discordSubmitDisplayName: doc.discordSubmitDisplayName,
        discordSubmitUsername: doc.discordSubmitUsername,
        detailUrl,
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
    } catch {
      /* non-fatal */
    }

    // Admin notifications (non-fatal)
    try {
      const admins = await db
        .collection<User>("users")
        .find({ $or: [{ role: "admin" }, { isAdmin: true }] })
        .project({ _id: 1 })
        .toArray();
      const reporterLabel = reporterUsername
        ? `@${reporterUsername}`
        : reporterDiscordUsername
          ? `Discord:${reporterDiscordUsername}`
          : "Anonymous";
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
              reporterUsername,
            },
          })
        )
      );
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({
      issueNumber,
      detailUrl,
      githubIssueUrl,
      message: "Suggestion submitted. Thank you!",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
