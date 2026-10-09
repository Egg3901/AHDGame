import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import {
  houseLimits,
  limitsFor,
  loadHouse,
  resolveCasinoPlayer,
  settleHouseBet,
  takeStake,
} from "@/lib/casino/house";
import { drawInstantGame, instantPlaySchema } from "@/lib/casino/instantGames";
import { cryptoRng } from "@/lib/casino/rng";
import { casinoFailure, guardCasinoPlayer, guardCasinoRequest } from "@/lib/casino/routeSupport";
import { maybeSweepCasino } from "@/lib/casino/sweep";

// POST /api/discord-bot/casino/play — Slots, roulette, crash or craps in one request.
// The stake is taken from the player's home-currency wallet, the server draws the
// result and the house settles it. Amounts are in the player's home currency.
// Auth: X-Bot-Token. Errors: 400 (invalid or over the table limit), 402, 403, 404, 503.
export async function POST(request: Request) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const parsed = await parseJsonBody(request, instantPlaySchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const play = parsed.data;
    const limited = guardCasinoPlayer(play.discordId);
    if (limited) return limited;

    const db = await getDb();
    maybeSweepCasino(db);
    const resolved = await resolveCasinoPlayer(db, play.discordId);
    if (!resolved.ok) return casinoFailure(resolved);
    const { player } = resolved;

    const limits = houseLimits((await loadHouse(db)).anchorBalance);
    const taken = await takeStake(db, player, play.stake, limits);
    if (!taken.ok) return casinoFailure(taken);

    const playId = new ObjectId().toString();
    const { multiplier, outcome } = drawInstantGame(play, cryptoRng);
    const settled = await settleHouseBet(db, {
      player,
      game: play.game,
      stakeLocal: play.stake,
      multiplier,
      limits,
      meta: { playId },
    });
    if (!settled.ok) return casinoFailure(settled);

    return NextResponse.json({
      playId,
      game: play.game,
      characterName: player.characterName,
      currency: player.currency,
      stake: settled.stake,
      multiplier,
      payout: settled.payout,
      net: settled.payout - settled.stake,
      capped: settled.capped,
      outcome,
      limits: limitsFor(player, houseLimits(settled.newHouseAnchor)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
