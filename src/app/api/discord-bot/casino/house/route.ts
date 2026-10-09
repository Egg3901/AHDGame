import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { houseLimits, limitsFor, loadHouse, resolveCasinoPlayer } from "@/lib/casino/house";
import { activeHighLow, publicSession } from "@/lib/casino/highlowSessions";
import { casinoFailure, guardCasinoRequest } from "@/lib/casino/routeSupport";
import { maybeSweepCasino } from "@/lib/casino/sweep";

// GET /api/discord-bot/casino/house?discordId= — The house bank, table limits and per-game
// figures. With a discordId, limits come back in that player's currency along with any
// high-low hand they have open.
// Auth: X-Bot-Token. Errors: 401, 403, 404 (unknown player).
export async function GET(request: Request) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const db = await getDb();
    maybeSweepCasino(db);

    const house = await loadHouse(db);
    const limits = houseLimits(house.anchorBalance);
    const games = Object.fromEntries(
      Object.entries(house.games ?? {}).map(([game, stats]) => [
        game,
        {
          played: stats?.played ?? 0,
          handleAnchor: Math.floor(stats?.handleAnchor ?? 0),
          paidOutAnchor: Math.floor(stats?.paidOutAnchor ?? 0),
        },
      ])
    );
    const body: Record<string, unknown> = {
      anchorBalance: Math.floor(limits.anchorBalance),
      maxStakeAnchor: limits.maxStakeAnchor,
      maxPayoutAnchor: limits.maxPayoutAnchor,
      games,
    };

    const discordId = new URL(request.url).searchParams.get("discordId");
    if (discordId) {
      const resolved = await resolveCasinoPlayer(db, discordId);
      if (!resolved.ok) return casinoFailure(resolved);
      const session = await activeHighLow(db, discordId);
      body.player = {
        characterName: resolved.player.characterName,
        rate: resolved.player.rate,
        ...limitsFor(resolved.player, limits),
        highlow: session ? publicSession(session) : null,
      };
    }
    return NextResponse.json(body);
  } catch (error) {
    return handleRouteError(error);
  }
}
