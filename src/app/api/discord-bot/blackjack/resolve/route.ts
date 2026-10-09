import { NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getTotalPersonalWealth } from "@/lib/currency/characterFunds";
import { getCurrencyFxRate } from "@/lib/currency/corporationCapital";
import { houseLimits, loadHouse, settleHouseBet } from "@/lib/casino/house";
import { casinoFailure, guardCasinoPlayer, guardCasinoRequest } from "@/lib/casino/routeSupport";

const resolveSchema = z.object({
  discordId: z.string().min(1, "discordId is required"),
  gameId: z.string().min(1, "gameId is required"),
  result: z.enum(["win", "loss", "push"]),
  // Bounded: an unbounded client multiplier could size a payout far beyond any
  // legitimate blackjack table (10x already covers 3:2 naturals with headroom).
  payoutMultiplier: z.number().positive().max(10).optional(),
});

interface PendingWager {
  gameId: string;
  discordId: string;
  characterId: ObjectId;
  wagerAmount: number;
  currency?: CurrencyCode;
  rate?: number;
  status: "pending";
}

/** House edge taken from blackjack winnings. BLACKJACK_HOUSE_EDGE overrides, clamped to 0..1. */
function blackjackHouseEdge(): number {
  return Math.min(Math.max(parseFloat(process.env.BLACKJACK_HOUSE_EDGE ?? "0.05"), 0), 1);
}

// POST /api/discord-bot/blackjack/resolve — Settles a dealt hand against the casino house.
// A win returns the stake plus winnings less the house edge; a push returns the stake.
// If the house cannot cover a win the stake is returned and the hand is void.
// Auth: X-Bot-Token. Errors: 400, 401, 404 (no pending wager), 503 (house short).
export async function POST(request: Request) {
  try {
    const denied = guardCasinoRequest(request);
    if (denied) return denied;
    const parsed = await parseJsonBody(request, resolveSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { discordId, gameId, result, payoutMultiplier = 1.0 } = parsed.data;
    const limited = guardCasinoPlayer(discordId);
    if (limited) return limited;

    const db = await getDb();
    const pending = await db
      .collection<PendingWager>("blackjackPendingWagers")
      .findOneAndDelete({ discordId, gameId, status: "pending" });
    if (!pending) {
      return errorResponse(404, "Pending wager not found", {
        extra: {
          message:
            "No active wager found for this game. The wager may have already been resolved or never placed.",
          discordId,
          gameId,
        },
      });
    }

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: pending.characterId });
    if (!character) return errorResponse(404, "Character not found", { extra: { discordId } });
    const currency = pending.currency ?? ("USD" as CurrencyCode);
    const rate = pending.rate ?? (await getCurrencyFxRate(db, currency));
    const player = {
      discordId,
      characterId: character._id,
      characterName: character.name,
      countryId: character.countryId,
      currency,
      rate,
    };

    const houseEdge = blackjackHouseEdge();
    const multiplier =
      result === "win" ? 1 + payoutMultiplier * (1 - houseEdge) : result === "push" ? 1 : 0;
    const previousCash = getTotalPersonalWealth(character, true);
    const limits = houseLimits((await loadHouse(db)).anchorBalance);
    const settled = await settleHouseBet(db, {
      player,
      game: "blackjack",
      stakeLocal: pending.wagerAmount,
      multiplier,
      limits,
      meta: { gameId, result },
    });
    if (!settled.ok) return casinoFailure(settled);

    const winnings = Math.max(0, settled.payout - pending.wagerAmount);
    return NextResponse.json({
      success: true,
      discordId,
      gameId,
      characterId: character._id.toString(),
      characterName: character.name,
      countryId: character.countryId,
      wagerAmount: pending.wagerAmount,
      result,
      payoutMultiplier: result === "win" ? payoutMultiplier : undefined,
      houseEdge: result === "win" ? houseEdge : undefined,
      payout: result === "win" ? winnings : undefined,
      totalReturned: settled.payout > 0 ? settled.payout : undefined,
      capped: settled.capped || undefined,
      previousCash,
      newCash: previousCash + settled.payout,
      newPoolBalance: Math.floor(settled.newHouseAnchor),
      currency,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
