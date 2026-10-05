import { NextResponse } from "next/server";
import { fetchDiscordInviteStats } from "@/lib/discord/inviteStats";
import { handleRouteError, errorResponse } from "@/lib/api/errors";

// GET /api/community/discord-stats — Public Discord invite member/online counts.
// Auth: none
// Errors: 503 when Discord is unreachable and no cached stats exist
export async function GET() {
  try {
    const stats = await fetchDiscordInviteStats();
    if (!stats) {
      return errorResponse(503, "Discord stats temporarily unavailable", {
        headers: { "Cache-Control": "public, s-maxage=30, no-transform" },
      });
    }

    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
