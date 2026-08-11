// POST /api/country/[code]/central-bank/reserve-pool-transfer
// Chair reallocates home-currency face between forexRevenue and lending reserveBalance.
// Once per RESERVE_POOL_TRANSFER_COOLDOWN_TURNS; capped at 50% of the source pool.
// Auth: chair or admin. Errors: 400, 401, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isSameCountry } from "@/lib/api/sameCountry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  RESERVE_POOL_TRANSFER_COOLDOWN_TURNS,
  RESERVE_POOL_TRANSFER_MAX_FRACTION,
  resolveReservePoolTransferAmount,
  turnsUntilReservePoolTransferReady,
  type ReservePoolTransferDirection,
} from "@/lib/centralBank/reservePoolTransfer";
import { getGameState } from "@/lib/gameState";
import type { CentralBank, Character, GameState } from "@/lib/db/types";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  direction: z.enum(["toLending", "toForex"]),
  amount: z.number().finite().positive().max(1_000_000_000_000_000),
});

async function sumOutstandingLoansFace(
  db: Awaited<ReturnType<typeof getDb>>,
  homeCurrency: string
): Promise<number> {
  const rows = await db
    .collection("characters")
    .aggregate<{ totalBalance: number; totalArrears: number }>([
      {
        $match: {
          $or: [
            { [`lineOfCredit.balances.${homeCurrency}`]: { $gt: 0 } },
            { [`lineOfCredit.arrears.${homeCurrency}`]: { $gt: 0 } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalBalance: { $sum: { $ifNull: [`$lineOfCredit.balances.${homeCurrency}`, 0] } },
          totalArrears: { $sum: { $ifNull: [`$lineOfCredit.arrears.${homeCurrency}`, 0] } },
        },
      },
    ])
    .toArray();
  return (rows[0]?.totalBalance ?? 0) + (rows[0]?.totalArrears ?? 0);
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const rawCountryId = code.toUpperCase();
    if (!(rawCountryId in COUNTRY_CONFIGS)) throw badRequest("Invalid country code");
    const countryId = rawCountryId as CountryId;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const direction = parsed.data.direction as ReservePoolTransferDirection;
    const requestedAmount = Math.floor(parsed.data.amount);

    const myChar = auth.user.character as Character | null;
    const isAdmin = auth.user.isAdmin === true;
    if (!myChar) throw forbidden("Character required");

    const db = await getDb();
    const bankId = getBankId(countryId);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank) throw notFound("Central bank not found");

    const isChair = !!bank.chairCharacterId && myChar._id.equals(bank.chairCharacterId);
    if (isChair && !isSameCountry(myChar, { countryId })) {
      throw forbidden("Chair must be a citizen of this country");
    }
    if (!isAdmin && !isChair) {
      throw forbidden("Only the current chair can reallocate reserve pools");
    }
    if (!isAdmin && bank.chairControlsLocked === true) {
      throw forbidden("Chair controls are locked by an administrator");
    }

    const homeCurrency = COUNTRY_CURRENCY_MAP[countryId];
    if (!homeCurrency) throw badRequest("Country has no forex currency");

    const gs = (await getGameState()) as Pick<GameState, "currentTurn"> | null;
    const currentTurn = gs?.currentTurn ?? 0;
    const cooldownRemaining = turnsUntilReservePoolTransferReady({
      currentTurn,
      lastTransferTurn: bank.lastReservePoolTransferTurn,
      isAdmin,
    });
    if (cooldownRemaining > 0) {
      throw badRequest(
        `Reserve pool transfers are limited to once every ${RESERVE_POOL_TRANSFER_COOLDOWN_TURNS} turns (once per day). ${cooldownRemaining} turn(s) remaining.`
      );
    }

    const forexRevenue = bank.forexRevenue ?? 0;
    const lendingReserves = bank.reserveBalance ?? 0;
    const totalDeposits = bank.nationalSavingsBalance ?? 0;
    const totalLoansOutstanding = await sumOutstandingLoansFace(db, homeCurrency);

    const { amount, limits } = resolveReservePoolTransferAmount({
      direction,
      amount: requestedAmount,
      forexRevenue,
      lendingReserves,
      totalDeposits,
      totalLoansOutstanding,
    });
    if (amount <= 0) {
      if (direction === "toLending") {
        throw badRequest(
          `Nothing available to move into lending (max ${Math.floor(RESERVE_POOL_TRANSFER_MAX_FRACTION * 100)}% of forex spread revenue).`
        );
      }
      throw badRequest(
        "Nothing available to move into forex reserves without reducing capacity below outstanding loans."
      );
    }
    if (amount < requestedAmount) {
      throw badRequest(
        direction === "toLending"
          ? `Amount exceeds the ${Math.floor(RESERVE_POOL_TRANSFER_MAX_FRACTION * 100)}% forex-revenue cap (max ${limits.maxToLending}).`
          : `Amount exceeds the safe lending→forex cap (max ${limits.maxToForex}; outstanding loans must stay covered).`
      );
    }

    const forexDelta = direction === "toLending" ? -amount : amount;
    const lendingDelta = direction === "toLending" ? amount : -amount;

    const filter: Record<string, unknown> = { _id: bankId };
    if (direction === "toLending") {
      filter.forexRevenue = { $gte: amount };
    } else {
      filter.reserveBalance = { $gte: amount };
    }

    const result = await db.collection<CentralBank>("centralBanks").updateOne(filter, {
      $inc: {
        forexRevenue: forexDelta,
        reserveBalance: lendingDelta,
      },
      $set: {
        lastReservePoolTransferTurn: currentTurn,
        updatedAt: new Date(),
      },
    });
    if (result.matchedCount === 0) {
      throw badRequest(
        direction === "toLending"
          ? "Insufficient forex spread revenue for this transfer"
          : "Insufficient lending reserves for this transfer"
      );
    }

    return NextResponse.json({
      success: true,
      direction,
      amount,
      forexRevenueDelta: forexDelta,
      reserveBalanceDelta: lendingDelta,
      maxToLending: limits.maxToLending,
      maxToForex: limits.maxToForex,
      nextTransferTurn: currentTurn + RESERVE_POOL_TRANSFER_COOLDOWN_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
