import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { computeUnreadCommentCounts, loadReadMapForSuggestions } from "@/lib/suggestions/readState";
import { loadReporterDisplayMap } from "@/lib/suggestions/reporterDisplay";
import {
  discordSubmitHandleForChip,
  discordSubmitPrimaryLabel,
} from "@/lib/suggestions/discordSubmitAttribution";

const STATUS_OPTIONS = [
  "not_reviewed",
  "planned",
  "in_progress",
  "completed",
  "not_implementing",
] as const;

// GET /api/admin/suggestions — List player forum suggestions (`suggestions` collection).
// Auth: requireAdmin
// Errors: 403
export const GET = withAdminAuth(async (auth, request: Request) => {
  try {
    const adminUserId = new ObjectId(auth.admin.userId);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = parseBoundedIntParam(searchParams, "limit", 50, 1, 100);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));

    const db = await getDb();
    const coll = getSuggestionsCollection(db);

    const filter: Record<string, unknown> = {};
    if (status && STATUS_OPTIONS.includes(status as (typeof STATUS_OPTIONS)[number])) {
      filter.status = status;
    }

    const [items, total] = await Promise.all([
      coll.find(filter).sort({ issueNumber: -1 }).skip(offset).limit(limit).toArray(),
      coll.countDocuments(filter),
    ]);

    const reporterMap = await loadReporterDisplayMap(
      db,
      items.map((f) => f.userId)
    );

    const readMap = await loadReadMapForSuggestions(
      db,
      adminUserId,
      items.map((f) => f._id)
    );
    const unreadList = await computeUnreadCommentCounts(
      db,
      { userId: adminUserId, isAdmin: true },
      items,
      readMap
    );

    const list = items.map((f, i) => {
      const rid = f.userId?.toString();
      const rep = rid ? reporterMap.get(rid) : undefined;
      const discordOnlyName = !f.userId ? discordSubmitPrimaryLabel(f) : null;
      const discordOnlyHandle = !f.userId ? discordSubmitHandleForChip(f) : null;
      return {
        id: f._id.toString(),
        issueNumber: f.issueNumber,
        category: f.category,
        gameSystem: f.gameSystem,
        title: f.title,
        status: f.status,
        priority: f.priority,
        screenshotUrl: f.screenshotUrl,
        commentCount: f.commentCount ?? 0,
        unreadCommentCount: unreadList[i] ?? 0,
        reporterUsername: rep?.username ?? null,
        reporterDiscordUsername: rep?.discordUsername ?? discordOnlyHandle,
        reporterCharacterName: rep?.characterName ?? discordOnlyName,
        githubIssueUrl: f.githubIssueUrl,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({
      items: list,
      total,
      limit,
      offset,
    });
  } catch (err) {
    return handleRouteError(err);
  }
});
