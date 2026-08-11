import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import type { PoliticalParty, Suggestion, User } from "@/lib/db/types";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { getSuggestionReactionsCollection } from "@/lib/db/collections/suggestionReactions";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { markSuggestionThreadRead } from "@/lib/suggestions/readState";
import {
  discordSubmitHandleForChip,
  discordSubmitPrimaryLabel,
} from "@/lib/suggestions/discordSubmitAttribution";

// GET /api/suggestions/public/[issueNumber] — Public suggestion detail for forum thread.
// Auth: public
// Errors: 400, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ issueNumber: string }> }
) {
  try {
    const { issueNumber: raw } = await params;
    const issueNum = parseInt(raw, 10);
    if (isNaN(issueNum) || issueNum < 1) {
      return NextResponse.json({ error: "Invalid suggestion id" }, { status: 400 });
    }

    const db = await getDb();
    const coll = getSuggestionsCollection(db);
    const s = await coll.findOne({ issueNumber: issueNum });
    if (!s) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    let reporterUsername: string | null = null;
    let reporterDiscordUsername: string | null = null;
    let reporterCharacterName: string | null = null;
    let reporterAvatarUrl: string | null = null;
    let reporterPartyAbbrev: string | null = null;
    let reporterStateCode: string | null = null;
    let reporterCountryId: string | null = null;

    if (s.userId) {
      const [u, character] = await Promise.all([
        db
          .collection<User>("users")
          .findOne({ _id: s.userId }, { projection: { username: 1, discordUsername: 1 } }),
        getCharacterByUserId(db, s.userId),
      ]);
      reporterUsername = u?.username ?? null;
      reporterDiscordUsername = u?.discordUsername ?? null;
      reporterCharacterName = character?.name ?? null;
      reporterAvatarUrl = character?.avatarUrl ?? null;
      reporterStateCode = character?.homeState?.toUpperCase() ?? null;
      reporterCountryId = character?.countryId ?? null;

      if (character?.party && character.party !== "independent") {
        const party = await db.collection<PoliticalParty>("politicalParties").findOne({
          sequentialId: parseInt(character.party),
          countryId: character.countryId,
        });
        reporterPartyAbbrev =
          party?.abbreviation?.trim() || party?.name.slice(0, 3).toUpperCase() || null;
      } else if (character?.party === "independent") {
        reporterPartyAbbrev = "IND";
      }
    } else {
      reporterCharacterName = discordSubmitPrimaryLabel(s);
      reporterDiscordUsername = discordSubmitHandleForChip(s);
    }

    const viewer = await verifyAuth();
    let userReaction: "like" | "dislike" | null = null;
    if (viewer?.userId) {
      const uid = new ObjectId(viewer.userId);
      await markSuggestionThreadRead(db, uid, s._id);
      const existing = await getSuggestionReactionsCollection(db).findOne({
        suggestionId: s._id,
        userId: uid,
      });
      userReaction = existing?.reaction ?? null;
    }

    let mergedIntoLink: { issueNumber: number; title: string } | null = null;
    if (s.mergedInto) {
      const target = await coll.findOne({ _id: s.mergedInto });
      if (target) mergedIntoLink = { issueNumber: target.issueNumber, title: target.title };
    }

    const mergedFromLinks: { issueNumber: number; title: string }[] = [];
    if (s.mergedFrom?.length) {
      const sources = await coll
        .find({ _id: { $in: s.mergedFrom } })
        .project({ issueNumber: 1, title: 1 })
        .toArray();
      for (const src of sources) {
        mergedFromLinks.push({ issueNumber: src.issueNumber, title: src.title });
      }
    }

    return NextResponse.json(
      serializeDetail(s, {
        reporterUsername,
        reporterDiscordUsername,
        reporterCharacterName,
        reporterAvatarUrl,
        reporterPartyAbbrev,
        reporterStateCode,
        reporterCountryId,
        mergedIntoLink,
        mergedFromLinks,
        userReaction,
      })
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

function serializeDetail(
  s: Suggestion,
  reporter: {
    reporterUsername: string | null;
    reporterDiscordUsername: string | null;
    reporterCharacterName: string | null;
    reporterAvatarUrl: string | null;
    reporterPartyAbbrev: string | null;
    reporterStateCode: string | null;
    reporterCountryId: string | null;
    mergedIntoLink: { issueNumber: number; title: string } | null;
    mergedFromLinks: { issueNumber: number; title: string }[];
    userReaction: "like" | "dislike" | null;
  }
) {
  return {
    id: s._id.toString(),
    issueNumber: s.issueNumber,
    category: s.category,
    gameSystem: s.gameSystem,
    title: s.title,
    description: s.description,
    impact: s.impact ?? null,
    priority: s.priority ?? null,
    status: s.status,
    screenshotUrl: s.screenshotUrl ?? null,
    githubIssueUrl: s.githubIssueUrl ?? null,
    commentCount: s.commentCount ?? 0,
    reactions: {
      like: Math.max(0, s.reactions?.like ?? 0),
      dislike: Math.max(0, s.reactions?.dislike ?? 0),
    },
    userReaction: reporter.userReaction,
    reporterUsername: reporter.reporterUsername,
    reporterDiscordUsername: reporter.reporterDiscordUsername,
    reporterCharacterName: reporter.reporterCharacterName,
    reporterAvatarUrl: reporter.reporterAvatarUrl,
    reporterPartyAbbrev: reporter.reporterPartyAbbrev,
    reporterStateCode: reporter.reporterStateCode,
    reporterCountryId: reporter.reporterCountryId,
    mergedIntoLink: reporter.mergedIntoLink,
    mergedFromLinks: reporter.mergedFromLinks,
    context: {
      pathname: s.context.pathname,
      url: s.context.url,
      capturedAt: s.context.capturedAt,
    },
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
