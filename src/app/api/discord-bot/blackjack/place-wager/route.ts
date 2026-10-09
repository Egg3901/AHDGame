import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character } from "@/lib/db/types";
import { getTotalPersonalWealth } from "@/lib/currency/characterFunds";
import {
  houseLimits,
  loadHouse,
  resolveCasinoPlayer,
  returnStake,
  takeStake,
} from "@/lib/casino/house";
import { casinoFailure, guardCasinoPlayer, guardCasinoRequest } from "@/lib/casino/routeSupport";

const placeWagerSchema = z.object({
  discordId: z.string().min(1, "discordId is required"),
  wagerAmount: z.number().positive("wagerAmount must be a positive number"),
  gameId: z.string().optional(),
});

// POST /api/discord-bot/blackjack/place-wager — Takes the stake from the player's home-currency
// wallet when the hand is dealt. The hand settles through /resolve against the casino house.
// Auth: X-Bot-Token. Errors: 400 (invalid or over the table limit), 402 (insufficient funds), 403, 404.
export async function POST(request: Request) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const parsed = await parseJsonBody(request, placeWagerSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { discordId, gameId: bodyGameId } = parsed.data;
    const limited = guardCasinoPlayer(discordId);
    if (limited) return limited;

    const wagerAmount = Math.floor(parsed.data.wagerAmount);
    const gameId = bodyGameId || new ObjectId().toString();
    const db = await getDb();

    const resolved = await resolveCasinoPlayer(db, discordId);
    if (!resolved.ok) return casinoFailure(resolved);
    const { player } = resolved;

    const limits = houseLimits((await loadHouse(db)).anchorBalance);
    const taken = await takeStake(db, player, wagerAmount, limits);
    if (!taken.ok) return casinoFailure(taken);

    // If the pending row cannot be written the hand cannot settle, so return the stake.
    try {
      await db.collection("blackjackPendingWagers").insertOne({
        gameId,
        discordId,
        characterId: player.characterId,
        wagerAmount,
        currency: player.currency,
        rate: player.rate,
        placedAt: new Date(),
        status: "pending",
      });
    } catch (error) {
      await returnStake(db, player, wagerAmount);
      throw error;
    }

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: player.characterId });
    const newCash = character ? getTotalPersonalWealth(character, true) : 0;

    return NextResponse.json({
      success: true,
      gameId,
      discordId,
      characterId: player.characterId.toString(),
      characterName: player.characterName,
      countryId: player.countryId,
      currency: player.currency,
      wagerAmount,
      previousCash: newCash + wagerAmount,
      newCash,
      message: `Wager of ${wagerAmount.toLocaleString()} ${player.currency} placed. Good luck!`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
