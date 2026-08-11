import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { parseBoundedIntParam } from "@/lib/api/validate";
import type { Suggestion, SuggestionStatus } from "@/lib/db/types";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { computeUnreadCommentCounts, loadReadMapForSuggestions } from "@/lib/suggestions/readState";
import { loadReporterDisplayMap, type ReporterDisplay } from "@/lib/suggestions/reporterDisplay";
import {
  discordSubmitHandleForChip,
  discordSubmitPrimaryLabel,
} from "@/lib/suggestions/discordSubmitAttribution";
import { getSuggestionReactionsCollection } from "@/lib/db/collections/suggestionReactions";

const CATEGORIES = [
  "feature_request",
  "ui_improvement",
  "game_balance",
  "new_content",
  "accessibility",
  "other",
] as const;

const STATUSES: SuggestionStatus[] = [
  "not_reviewed",
  "planned",
  "in_progress",
  "completed",
  "not_implementing",
];

const GAME_SYSTEMS = [
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
] as const;

// GET /api/suggestions/public — Paginated player suggestions (public board).
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get("sort") ?? "recent";
    const category = searchParams.get("category");
    const gameSystem = searchParams.get("gameSystem");
    const statusFilter = searchParams.get("status");

    const limit = parseBoundedIntParam(searchParams, "limit", 24, 1, 50);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));

    if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return NextResponse.json({ error: "Invalid category filter" }, { status: 400 });
    }
    if (gameSystem && !GAME_SYSTEMS.includes(gameSystem as (typeof GAME_SYSTEMS)[number])) {
      return NextResponse.json({ error: "Invalid gameSystem filter" }, { status: 400 });
    }
    if (statusFilter && !STATUSES.includes(statusFilter as SuggestionStatus)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    const filter: Record<string, unknown> = { mergedInto: { $exists: false } };
    if (category) filter.category = category;
    if (gameSystem) filter.gameSystem = gameSystem;
    if (statusFilter) filter.status = statusFilter;

    const db = await getDb();
    const coll = getSuggestionsCollection(db);

    let sortSpec: Record<string, 1 | -1> = { createdAt: -1 };
    if (sort === "oldest") sortSpec = { createdAt: 1 };
    if (sort === "comments") sortSpec = { commentCount: -1, createdAt: -1 };

    const [items, total] = await Promise.all([
      coll.find(filter).sort(sortSpec).skip(offset).limit(limit).toArray(),
      coll.countDocuments(filter),
    ]);

    const reporterMap = await loadReporterDisplayMap(
      db,
      items.map((s) => s.userId)
    );

    const viewer = await getAuthUser();
    let unreadList: number[] = items.map(() => 0);
    const userReactionMap = new Map<string, "like" | "dislike">();
    if (viewer?.userId) {
      const uid = new ObjectId(viewer.userId);
      const readMap = await loadReadMapForSuggestions(
        db,
        uid,
        items.map((s) => s._id)
      );
      unreadList = await computeUnreadCommentCounts(
        db,
        { userId: uid, isAdmin: viewer.isAdmin === true },
        items,
        readMap
      );
      if (items.length > 0) {
        const viewerReactions = await getSuggestionReactionsCollection(db)
          .find({ userId: uid, suggestionId: { $in: items.map((s) => s._id) } })
          .toArray();
        for (const r of viewerReactions) {
          userReactionMap.set(r.suggestionId.toString(), r.reaction);
        }
      }
    }

    const list = items.map((s, i) =>
      serializeListItem(s, reporterMap, unreadList[i] ?? 0, userReactionMap.get(s._id.toString()) ?? null)
    );

    return NextResponse.json({ items: list, total, limit, offset });
  } catch (err) {
    return handleRouteError(err);
  }
}

function serializeListItem(
  s: Suggestion,
  reporterMap: Map<string, ReporterDisplay>,
  unreadCommentCount: number,
  userReaction: "like" | "dislike" | null
) {
  const rid = s.userId?.toString();
  const rep = rid ? reporterMap.get(rid) : undefined;
  const discordOnlyName = !s.userId ? discordSubmitPrimaryLabel(s) : null;
  const discordOnlyHandle = !s.userId ? discordSubmitHandleForChip(s) : null;
  return {
    id: s._id.toString(),
    issueNumber: s.issueNumber,
    category: s.category,
    gameSystem: s.gameSystem,
    title: s.title,
    descriptionPreview: clipText(s.description, 320),
    impactPreview: s.impact ? clipText(s.impact, 220) : null,
    status: s.status,
    screenshotUrl: s.screenshotUrl ?? null,
    commentCount: s.commentCount ?? 0,
    unreadCommentCount,
    reactions: {
      like: Math.max(0, s.reactions?.like ?? 0),
      dislike: Math.max(0, s.reactions?.dislike ?? 0),
    },
    userReaction,
    reporterCharacterName: rep?.characterName ?? discordOnlyName,
    reporterDiscordUsername: rep?.discordUsername ?? discordOnlyHandle,
    reporterUsername: rep?.username ?? null,
    reporterAvatarUrl: rep?.avatarUrl ?? null,
    reporterPartyAbbrev: rep?.partyAbbrev ?? null,
    reporterStateCode: rep?.stateCode ?? null,
    reporterCountryId: rep?.countryId ?? null,
    mergedInto: s.mergedInto ? s.mergedInto.toString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function clipText(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
