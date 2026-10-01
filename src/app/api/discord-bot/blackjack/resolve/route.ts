import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_BLACKJACK_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import type { DiscordBotFund } from "@/lib/db/types/discordBotFund";
import type { Character } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getTotalPersonalWealth,
  buildPersonalBalanceInc,
  getHomeCurrency,
} from "@/lib/currency/characterFunds";

const resolveSchema = z.object({
  discordId: z.string().min(1, "discordId is required"),
  gameId: z.string().min(1, "gameId is required"),
  result: z.enum(["win", "loss", "push"]),
  // Bounded: an unbounded client multiplier could size a payout far beyond any
  // legitimate blackjack table (10x already covers 3:2 naturals with headroom).
  payoutMultiplier: z.number().positive().max(10).optional(),
});

// POST /api/discord-bot/blackjack/resolve — Resolves a pending blackjack wager.
// Returns wager + winnings on win, or keeps wager on loss.
// Auth: requireAdminOrApiKey (via X-Bot-Token header)
// Errors: 400 (invalid request), 401 (unauthorized), 404 (pending wager not found)
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:blackjack-resolve",
      BOT_BLACKJACK_LIMITS.maxRequests,
      BOT_BLACKJACK_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, resolveSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { discordId, gameId, result, payoutMultiplier = 1.0 } = parsed.data;

    const db = await getDb();

    // Find and remove the pending wager
    const pendingWager = await db.collection("blackjackPendingWagers").findOneAndDelete({
      discordId,
      gameId,
      status: "pending",
    });

    if (!pendingWager) {
      return NextResponse.json(
        {
          error: "Pending wager not found",
          message:
            "No active wager found for this game. The wager may have already been resolved or never placed.",
          discordId,
          gameId,
        },
        { status: 404 }
      );
    }

    const wagerAmount = pendingWager.wagerAmount;
    const characterId = pendingWager.characterId;
    const wagerCurrency = pendingWager.currency;

    // Get current character state
    const character = await db.collection<Character>("characters").findOne({ _id: characterId });
    if (!character) {
      return NextResponse.json({ error: "Character not found", discordId }, { status: 404 });
    }

    const forexEnabled = await isForexEnabled();
    // Use currency from pending wager (captured at place-wager time)
    // Fall back to character's home currency for legacy wagers
    const homeCurrency = wagerCurrency || getHomeCurrency(character);
    const currentCash = getTotalPersonalWealth(character, forexEnabled);

    // Get or create the prize pool fund
    const fund = await db
      .collection<DiscordBotFund>("discordBotFunds")
      .findOne({ name: "blackjack_prize_pool" });

    if (!fund) {
      return NextResponse.json(
        {
          error: "Prize pool not initialized",
          message: "The blackjack prize pool has not been set up yet. Contact an admin.",
        },
        { status: 503 }
      );
    }

    // House edge applied server-side on all wins. Default 5% — configurable via
    // BLACKJACK_HOUSE_EDGE env var (0.0–1.0). Reduces effective winnings without
    // affecting the reported win/loss result. The wager is always returned on a win.
    const HOUSE_EDGE = Math.min(
      Math.max(parseFloat(process.env.BLACKJACK_HOUSE_EDGE ?? "0.05"), 0),
      1
    );

    // Calculate the outcome
    let cashChange: number;
    let poolChange: number;
    let payout: number = 0;
    let winnings = 0;
    const now = new Date();

    if (result === "win") {
      // Player wins: return wager + winnings reduced by house edge
      const grossWinnings = Math.floor(wagerAmount * payoutMultiplier);
      winnings = Math.floor(grossWinnings * (1 - HOUSE_EDGE));
      payout = wagerAmount + winnings; // Return wager + net winnings
      cashChange = payout;
      poolChange = -winnings; // Pool only loses the net winnings, keeps the wager
    } else if (result === "push") {
      // Push (tie): return wager only
      cashChange = wagerAmount;
      poolChange = 0;
      payout = wagerAmount;
    } else {
      // Player loses: wager stays in pool
      cashChange = 0;
      poolChange = wagerAmount;
      payout = 0;
    }

    // Build fund update with currency-specific tracking when forex enabled
    const fundUpdate: {
      $inc: Record<string, number>;
      $set: { updatedAt: Date };
    } = {
      $inc: {
        totalWagered: wagerAmount,
        gamesPlayed: 1,
      },
      $set: { updatedAt: now },
    };

    if (forexEnabled && fund.currencyBalances) {
      // Forex mode: update currency-specific balance and track net payout
      fundUpdate.$inc[`currencyBalances.${homeCurrency}`] = poolChange;

      if (result === "win") {
        // Track net payout (after house edge) - this is the actual cash outflow
        fundUpdate.$inc.totalPaidOut = Math.floor(
          wagerAmount * payoutMultiplier * (1 - HOUSE_EDGE)
        );
      } else if (result === "loss") {
        fundUpdate.$inc.totalCollected = wagerAmount;
      }
      // Push: no tracking metrics updated
    } else {
      // Legacy mode: use single balance field
      fundUpdate.$inc.balance = poolChange;

      if (result === "win") {
        // Track gross payout (legacy behavior)
        fundUpdate.$inc.totalPaidOut = Math.floor(wagerAmount * payoutMultiplier);
      } else if (result === "loss") {
        fundUpdate.$inc.totalCollected = wagerAmount;
      }
    }

    const poolBalance = fund.currencyBalances?.[homeCurrency as CurrencyCode] ?? fund.balance;

    if (result === "win" && winnings > 0) {
      // The pool debit is atomic with its sufficiency check. The old code read
      // the balance, compared in memory, then applied a blind $inc — two
      // concurrent winning resolves both passed the read and drove the pool
      // negative, paying out money the pool did not hold.
      const poolFilter: Record<string, unknown> = { name: "blackjack_prize_pool" };
      if (forexEnabled && fund.currencyBalances) {
        poolFilter[`currencyBalances.${homeCurrency}`] = { $gte: winnings };
      } else {
        poolFilter.balance = { $gte: winnings };
      }
      const poolDebit = await db
        .collection<DiscordBotFund>("discordBotFunds")
        .updateOne(poolFilter, fundUpdate);
      if (poolDebit.matchedCount === 0) {
        return NextResponse.json(
          {
            error: "Prize pool insufficient",
            message: "The prize pool doesn't have enough funds for this payout. Contact an admin.",
            poolBalance,
            requiredPayout: winnings,
            currency: homeCurrency,
          },
          { status: 503 }
        );
      }

      const charUpdate = await db.collection<Character>("characters").updateOne(
        { _id: characterId },
        {
          $inc: buildPersonalBalanceInc(cashChange, homeCurrency, forexEnabled),
          $set: { updatedAt: now },
        }
      );
      if (charUpdate.matchedCount === 0) {
        // Compensate the pool debit; a deleted character must not drain it.
        const reverseInc = Object.fromEntries(
          Object.entries(fundUpdate.$inc).map(([k, v]) => [k, -v])
        );
        await db
          .collection<DiscordBotFund>("discordBotFunds")
          .updateOne({ name: "blackjack_prize_pool" }, { $inc: reverseInc })
          .catch(() => {});
        return NextResponse.json(
          { error: "Failed to update character funds", discordId },
          { status: 500 }
        );
      }
    } else {
      // Loss/push only add to the pool (or leave it flat) — no sufficiency
      // guard needed.
      const updateResults = await Promise.all([
        db.collection<Character>("characters").updateOne(
          { _id: characterId },
          {
            $inc: buildPersonalBalanceInc(cashChange, homeCurrency, forexEnabled),
            $set: { updatedAt: now },
          }
        ),
        db
          .collection<DiscordBotFund>("discordBotFunds")
          .updateOne({ name: "blackjack_prize_pool" }, fundUpdate),
      ]);

      if (updateResults[0].matchedCount === 0) {
        return NextResponse.json(
          { error: "Failed to update character funds", discordId },
          { status: 500 }
        );
      }

      if (updateResults[1].matchedCount === 0) {
        return NextResponse.json(
          { error: "Failed to update prize pool", discordId },
          { status: 500 }
        );
      }
    }

    const newCash = currentCash + cashChange;
    const newPoolBalance = poolBalance + poolChange;

    return NextResponse.json({
      success: true,
      discordId,
      gameId,
      characterId: characterId.toString(),
      characterName: character.name,
      countryId: character.countryId,
      wagerAmount,
      result,
      payoutMultiplier: result === "win" ? payoutMultiplier : undefined,
      houseEdge: result === "win" ? HOUSE_EDGE : undefined,
      payout:
        result === "win"
          ? Math.floor(wagerAmount * payoutMultiplier * (1 - HOUSE_EDGE))
          : undefined,
      totalReturned: payout > 0 ? payout : undefined,
      previousCash: currentCash,
      newCash,
      previousPoolBalance: poolBalance,
      newPoolBalance,
      currency: homeCurrency,
      gamesPlayed: (fund.gamesPlayed ?? 0) + 1,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
