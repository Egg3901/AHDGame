// POST /api/country/[code]/central-bank/reserve-pool-transfer
// Chair reallocates home-currency face between forexRevenue and lending reserveBalance.
// Once per RESERVE_POOL_TRANSFER_COOLDOWN_TURNS; capped at 50% of the source pool.
// Auth: chair or admin. Errors: 400, 401, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isSameCountry } from "@/lib/api/sameCountry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { ObjectId } from "mongodb";
import {
  executeReservePoolTransfer,
  ReservePoolTransferRejected,
} from "@/lib/centralBank/reservePoolTransferCommands";
import { getGameState } from "@/lib/gameState";
import type { CentralBank, Character, GameState } from "@/lib/db/types";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  operationId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,128}$/)
    .optional(),
  direction: z.enum(["toLending", "toForex"]),
  amount: z.number().finite().positive().max(1_000_000_000_000_000),
});

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
      return errorResponse(parsed.status, parsed.error);
    }
    const direction = parsed.data.direction;
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
    const result = await executeReservePoolTransfer(db, bank, {
      operationId: parsed.data.operationId ?? new ObjectId().toHexString(),
      countryId,
      direction,
      amount: requestedAmount,
      turn: currentTurn,
      isAdmin,
      userId: auth.user.userId,
      characterId: myChar._id.toHexString(),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReservePoolTransferRejected)
      return handleRouteError(badRequest(error.message));
    return handleRouteError(error);
  }
}
