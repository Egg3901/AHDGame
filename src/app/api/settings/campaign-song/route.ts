import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { campaignSongSchema } from "@/lib/api/schemas/settings";
import type { Character } from "@/lib/db/types";

// Extract YouTube video ID from various URL formats
function extractYouTubeId(input: string): string | null {
  if (!input || input.trim() === "") return null;

  const trimmed = input.trim();

  // If it's just a video ID (11 characters, alphanumeric and dashes/underscores)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Match youtube.com/watch?v=VIDEO_ID
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  // Match youtu.be/VIDEO_ID
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  // Match youtube.com/embed/VIDEO_ID
  const embedMatch = trimmed.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  return null;
}

// PATCH /api/settings/campaign-song — Updates the authenticated character's campaign song YouTube URL and autoplay preference
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, campaignSongSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { campaignSongUrl, campaignSongAutoplay } = parsed.data;

    const db = await getDb();

    const character = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(user.userId),
    });

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    // Validate and extract YouTube ID if URL provided
    let videoId: string | null = null;
    if (campaignSongUrl && campaignSongUrl.trim() !== "") {
      videoId = extractYouTubeId(campaignSongUrl);
      if (!videoId) {
        return NextResponse.json(
          {
            error:
              "Invalid YouTube URL or video ID. Please provide a valid youtube.com/watch?v= URL or an 11-character video ID.",
          },
          { status: 400 }
        );
      }
    }

    const updateData: Partial<Character> = {};
    if (videoId) {
      updateData.campaignSongUrl = videoId;
    } else {
      updateData.campaignSongUrl = "";
    }
    if (campaignSongAutoplay !== undefined) {
      updateData.campaignSongAutoplay = campaignSongAutoplay;
    }

    await db
      .collection<Character>("characters")
      .updateOne({ _id: character._id }, { $set: updateData });

    return NextResponse.json({ success: true, videoId });
  } catch (error) {
    return handleRouteError(error);
  }
}
