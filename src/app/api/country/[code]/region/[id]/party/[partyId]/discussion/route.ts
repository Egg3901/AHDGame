import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character, PartyDiscussionPost } from "@/lib/db/types";

// GET /api/country/[code]/region/[id]/party/[partyId]/discussion
// POST /api/country/[code]/region/[id]/party/[partyId]/discussion
// Auth: state party member, mod, or admin
// Errors: 400, 401, 403, 404, 429

const DISCUSSION_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const PAGE_SIZE = 20;

const postBodySchema = z.object({
  content: z
    .string()
    .min(1, "Post cannot be empty")
    .max(1000, "Post cannot exceed 1000 characters"),
});

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id: stateId, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;
    const user = auth.user;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const isMember = character.party === partyId && character.homeState === stateId.toUpperCase();
    const canView = isMember || user.isAdmin || user.isModerator;
    if (!canView) {
      return NextResponse.json({ error: "Members only" }, { status: 403 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const skip = (page - 1) * PAGE_SIZE;

    const col = db.collection<PartyDiscussionPost>("partyDiscussionPosts");
    const query = {
      partyId,
      countryId,
      scope: "state" as const,
      regionId: stateId.toUpperCase(),
    };
    const [rawPosts, total] = await Promise.all([
      col.find(query).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE).toArray(),
      col.countDocuments(query),
    ]);

    const lastPost = character.lastDiscussionPostAt
      ? new Date(character.lastDiscussionPostAt).getTime()
      : 0;
    const cooldownRemaining = Math.max(
      0,
      Math.ceil((lastPost + DISCUSSION_COOLDOWN_MS - Date.now()) / 1000)
    );

    const posts = rawPosts.map((p) => ({
      id: p._id.toString(),
      authorName: p.deletedAt ? null : p.authorName,
      content: p.deletedAt ? null : p.content,
      createdAt: p.createdAt,
      deleted: !!p.deletedAt,
    }));

    return NextResponse.json({ posts, total, page, cooldownRemaining });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: stateId, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;
    const user = auth.user;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const isMember = character.party === partyId && character.homeState === stateId.toUpperCase();
    const canPost = isMember || user.isAdmin || user.isModerator;
    if (!canPost) {
      return NextResponse.json({ error: "Members only" }, { status: 403 });
    }

    if (character.lastDiscussionPostAt) {
      const elapsed = Date.now() - new Date(character.lastDiscussionPostAt).getTime();
      if (elapsed < DISCUSSION_COOLDOWN_MS) {
        const retryAfter = Math.ceil((DISCUSSION_COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          { error: "You can only post once per hour", retryAfter },
          { status: 429 }
        );
      }
    }

    const parsed = await parseJsonBody(request, postBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const now = new Date();
    const col = db.collection<PartyDiscussionPost>("partyDiscussionPosts");
    const newPost: Omit<PartyDiscussionPost, "_id"> = {
      partyId,
      countryId,
      scope: "state",
      regionId: stateId.toUpperCase(),
      authorCharacterId: character._id,
      authorName: character.name,
      content: parsed.data.content,
      createdAt: now,
    };
    const result = await col.insertOne(newPost as PartyDiscussionPost);

    await db
      .collection<Character>("characters")
      .updateOne({ _id: character._id }, { $set: { lastDiscussionPostAt: now } });

    return NextResponse.json({
      post: {
        id: result.insertedId.toString(),
        authorName: character.name,
        content: parsed.data.content,
        createdAt: now,
        deleted: false,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
