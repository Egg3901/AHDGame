import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { suggestionCommentSchema } from "@/lib/api/schemas/suggestion";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { containsSlur } from "@/lib/moderation";
import type { Character, PoliticalParty, SuggestionComment } from "@/lib/db/types";
import { getSuggestionCommentsCollection } from "@/lib/db/collections/suggestionComments";
import { getSuggestionsCollection } from "@/lib/db/collections/suggestions";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { createNotification } from "@/lib/notifications";

// GET /api/suggestions/public/[issueNumber]/comments — List comments (newest first, paginated).
// Auth: public
// Errors: 400, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ issueNumber: string }> }
) {
  try {
    const { issueNumber: raw } = await params;
    const issueNum = parseInt(raw, 10);
    if (isNaN(issueNum) || issueNum < 1) {
      return NextResponse.json({ error: "Invalid suggestion id" }, { status: 400 });
    }

    const db = await getDb();
    const suggestions = getSuggestionsCollection(db);
    const s = await suggestions.findOne({ issueNumber: issueNum });
    if (!s) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") ?? "20", 10)));
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const skip = (page - 1) * limit;

    const coll = getSuggestionCommentsCollection(db);
    const [comments, total] = await Promise.all([
      coll
        .find({ suggestionId: s._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      coll.countDocuments({ suggestionId: s._id }),
    ]);

    const userIds = [...new Set(comments.map((c) => c.userId))];
    const borderMap =
      userIds.length > 0 ? await fetchBordersByUserIds(db, userIds) : new Map<string, unknown>();

    // Batch-load character + party data for comment authors
    const characters = await db
      .collection<Character>("characters")
      .find({ userId: { $in: userIds } })
      .project({
        userId: 1,
        homeState: 1,
        countryId: 1,
        party: 1,
        avatarUrl: 1,
      })
      .toArray();
    const charByUser = new Map(characters.map((c) => [c.userId.toString(), c]));

    const partySeqIds = new Set<string>();
    for (const c of characters) {
      if (c.party && c.party !== "independent") partySeqIds.add(c.party);
    }
    const partyMap = new Map<string, PoliticalParty>();
    if (partySeqIds.size > 0) {
      const parties = await db
        .collection<PoliticalParty>("politicalParties")
        .find({ sequentialId: { $in: [...partySeqIds].map(Number) } })
        .toArray();
      for (const p of parties) partyMap.set(`${p.countryId}:${p.sequentialId}`, p);
    }

    const serialized = comments.map((c) => {
      const border = borderMap.get(c.userId.toString()) as
        | { borderKey?: string | null; tintColor?: string | null }
        | undefined;
      const char = charByUser.get(c.userId.toString());
      let authorPartyAbbrev: string | null = null;
      let authorStateCode: string | null = null;
      let authorCountryId: string | null = null;
      if (char) {
        authorStateCode = char.homeState?.toUpperCase() ?? null;
        authorCountryId = char.countryId ?? null;
        if (char.party && char.party !== "independent") {
          const party = partyMap.get(`${char.countryId}:${char.party}`);
          authorPartyAbbrev =
            party?.abbreviation?.trim() || party?.name.slice(0, 3).toUpperCase() || null;
        } else if (char.party === "independent") {
          authorPartyAbbrev = "IND";
        }
      }
      return {
        _id: c._id.toString(),
        /** Character name as stored on the comment (who posted). */
        authorName: c.authorName,
        authorAvatarUrl: c.authorAvatarUrl ?? char?.avatarUrl ?? null,
        authorParty: c.authorParty ?? null,
        authorPartyAbbrev,
        authorStateCode,
        authorCountryId,
        authorBorderKey: border?.borderKey ?? null,
        authorTintColor: border?.tintColor ?? null,
        body: c.body,
        createdAt: c.createdAt.toISOString(),
        userId: c.userId.toString(),
      };
    });

    const hasMore = skip + comments.length < total;

    return NextResponse.json({ comments: serialized, total, page, limit, hasMore });
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/suggestions/public/[issueNumber]/comments — Add comment (requires character).
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ issueNumber: string }> }
) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(`suggestion-comment:${user.userId}`, 40, 60_000);
    if (!rateLimit.ok)
      return rateLimitResponse(
        rateLimit.retryAfter,
        `You've posted several comments in a short time. Please wait about ${Math.max(1, rateLimit.retryAfter ?? 60)} seconds before trying again.`
      );

    const { issueNumber: raw } = await params;
    const issueNum = parseInt(raw, 10);
    if (isNaN(issueNum) || issueNum < 1) {
      return NextResponse.json({ error: "Invalid suggestion id" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, suggestionCommentSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { body } = parsed.data;

    if (containsSlur(body)) {
      return NextResponse.json(
        { error: "Your comment contains prohibited language and cannot be submitted." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const suggestions = getSuggestionsCollection(db);
    const s = await suggestions.findOne({ issueNumber: issueNum });
    if (!s) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    const character = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(user.userId) });

    if (!character) {
      return NextResponse.json({ error: "Character required to comment" }, { status: 403 });
    }

    const now = new Date();
    const commentDoc: Omit<SuggestionComment, "_id"> = {
      suggestionId: s._id,
      userId: new ObjectId(user.userId),
      characterId: character._id,
      authorName: character.name,
      authorAvatarUrl: character.avatarUrl,
      authorParty: character.party,
      body,
      createdAt: now,
    };

    const ins = await getSuggestionCommentsCollection(db).insertOne(commentDoc as SuggestionComment);
    await suggestions.updateOne({ _id: s._id }, { $inc: { commentCount: 1 }, $set: { updatedAt: now } });

    const borderMap = await fetchBordersByUserIds(db, [new ObjectId(user.userId)]);
    const border = borderMap.get(user.userId);

    // Notify the suggestion reporter (if it's not the commenter)
    if (s.userId && !s.userId.equals(new ObjectId(user.userId))) {
      await createNotification({
        userId: s.userId,
        type: "player_suggestion_new_comment",
        title: `New comment on S#${s.issueNumber}`,
        message: `${character.name} commented on your suggestion "${s.title}"`,
        metadata: {
          suggestionIssueNumber: s.issueNumber,
          suggestionId: s._id.toString(),
        },
      });
    }

    let authorPartyAbbrev: string | null = null;
    if (character.party && character.party !== "independent") {
      const party = await db.collection<PoliticalParty>("politicalParties").findOne({
        sequentialId: parseInt(character.party),
        countryId: character.countryId,
      });
      authorPartyAbbrev =
        party?.abbreviation?.trim() || party?.name.slice(0, 3).toUpperCase() || null;
    } else if (character.party === "independent") {
      authorPartyAbbrev = "IND";
    }

    return NextResponse.json(
      {
        comment: {
          _id: ins.insertedId.toString(),
          authorName: commentDoc.authorName,
          authorAvatarUrl: commentDoc.authorAvatarUrl ?? null,
          authorParty: commentDoc.authorParty ?? null,
          authorPartyAbbrev,
          authorStateCode: character.homeState?.toUpperCase() ?? null,
          authorCountryId: character.countryId ?? null,
          authorBorderKey: border?.borderKey ?? null,
          authorTintColor: border?.tintColor ?? null,
          body: commentDoc.body,
          createdAt: now.toISOString(),
          userId: user.userId,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleRouteError(err);
  }
}