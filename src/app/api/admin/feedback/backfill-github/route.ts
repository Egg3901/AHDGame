import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { createGitHubIssue, syncFeedbackToGitHub } from "@/lib/github";
import type { Feedback, User } from "@/lib/db/types";
import { ObjectId } from "mongodb";

/**
 * POST /api/admin/feedback/backfill-github
 * 1. Backfills missing githubIssueNumber from githubIssueUrl where the URL
 *    was stored but the number field was not (legacy records).
 * 2. Creates GitHub issues for all feedback entries that don't have one yet.
 * 3. Syncs current status (state + labels) for ALL linked issues so GitHub
 *    reflects resolved / wont_fix / in_progress correctly.
 * Returns { created, failed, synced, total }.
 */
// POST /api/admin/feedback/backfill-github — Backfill GitHub issues for all unlinked feedback and sync statuses.
// Auth: requireAdmin
// Errors: 400, 401, 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const token = process.env.GIT_TOKEN;
    const repo = process.env.GITHUB_REPO;
    if (!token || !repo) {
      return NextResponse.json(
        { error: "GIT_TOKEN and GITHUB_REPO environment variables are not configured." },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Step 1: Backfill githubIssueNumber for items that have githubIssueUrl
    // but are missing the number field (created before that field was introduced).
    const missingNumber = (await db
      .collection("feedback")
      .find({ githubIssueUrl: { $ne: null }, githubIssueNumber: null })
      .toArray()) as unknown as Feedback[];

    for (const f of missingNumber) {
      const match = f.githubIssueUrl!.match(/\/issues\/(\d+)/);
      if (match) {
        await db
          .collection("feedback")
          .updateOne(
            { _id: f._id },
            { $set: { githubIssueNumber: parseInt(match[1], 10), updatedAt: new Date() } }
          );
      }
    }

    // Step 2: Create GitHub issues for feedback without any link.
    const unlogged = (await db
      .collection("feedback")
      .find({ githubIssueUrl: null })
      .sort({ issueNumber: 1 })
      .toArray()) as unknown as Feedback[];

    // Resolve reporter usernames in one batch
    const userIds = [
      ...new Set(unlogged.map((f) => f.userId).filter((id): id is ObjectId => id != null)),
    ];
    const users =
      userIds.length > 0
        ? await db
            .collection<User>("users")
            .find({ _id: { $in: userIds } })
            .project({ _id: 1, username: 1 })
            .toArray()
        : [];
    const usernameMap = new Map(users.map((u) => [u._id.toString(), u.username]));

    let created = 0;
    let failed = 0;

    for (const feedback of unlogged) {
      const reporterUsername = feedback.userId
        ? (usernameMap.get(feedback.userId.toString()) ?? null)
        : null;

      const gh = await createGitHubIssue({
        issueNumber: feedback.issueNumber,
        type: feedback.type,
        title: feedback.title,
        description: feedback.description,
        category: feedback.category,
        stepsToReproduce: feedback.stepsToReproduce,
        severity: feedback.severity,
        impact: feedback.impact,
        priority: feedback.priority,
        context: feedback.context,
        reporterUsername,
        screenshotUrl: feedback.screenshotUrl,
      });

      if (gh) {
        await db.collection("feedback").updateOne(
          { _id: feedback._id },
          {
            $set: { githubIssueUrl: gh.url, githubIssueNumber: gh.number, updatedAt: new Date() },
          }
        );
        created++;
      } else {
        failed++;
      }
    }

    // Step 3: Sync current status (open/closed + labels) for ALL linked issues.
    // This closes resolved/wont_fix issues and updates labels without posting comments.
    const allLinked = (await db
      .collection("feedback")
      .find({ githubIssueNumber: { $exists: true, $ne: null } })
      .toArray()) as unknown as Feedback[];

    let synced = 0;
    for (const feedback of allLinked) {
      await syncFeedbackToGitHub({
        githubIssueNumber: feedback.githubIssueNumber!,
        newStatus: feedback.status,
        skipComment: true,
      });
      synced++;
    }

    return NextResponse.json({ created, failed, synced, total: unlogged.length });
  } catch (err) {
    return handleRouteError(err);
  }
}
