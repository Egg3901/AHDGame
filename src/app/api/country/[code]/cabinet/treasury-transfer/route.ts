// POST /api/country/[code]/cabinet/treasury-transfer - Transfer treasury cash to CB FX reserve
// Auth: requireAuth - caller must hold the country's financeMinisterCabinetId seat (admin bypass)
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  executeTreasuryReserveTransfer,
  TreasuryReserveTransferRejected,
} from "@/lib/budget/treasuryReserveTransfer";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameState } from "@/lib/gameState";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  amount: z.number().positive(),
  operationId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  justification: z.string().max(200).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) throw notFound("Country not found");
    if (!config.financeMinisterCabinetId) {
      throw badRequest("Treasury transfer is not configured for this country");
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const myChar = auth.user.character;
    if (!myChar) throw forbidden("Character required");

    const isAdmin = auth.user.isAdmin === true;
    if (!isAdmin) {
      const member = await getCabinetMembersCollection(db).findOne({
        countryId,
        positionId: config.financeMinisterCabinetId,
        characterId: myChar._id,
      });
      if (!member) {
        throw forbidden(
          `Only the ${config.financeMinisterCabinetId} for ${countryId} can transfer to FX reserves`
        );
      }
    }

    const gameState = await getGameState();
    const record = await executeTreasuryReserveTransfer(db, {
      operationId: parsed.data.operationId ?? new ObjectId().toHexString(),
      countryId,
      amount: parsed.data.amount,
      justification: parsed.data.justification,
      turn: gameState?.currentTurn ?? 0,
      isAdmin,
      actorId: myChar._id ?? new ObjectId(auth.user.userId),
      actorName: myChar.name ?? auth.user.username ?? "Unknown",
    });

    return NextResponse.json({ success: true, transferred: parsed.data.amount, record });
  } catch (error) {
    if (error instanceof TreasuryReserveTransferRejected)
      return handleRouteError(
        error.status === 404 ? notFound(error.message) : badRequest(error.message)
      );
    return handleRouteError(error);
  }
}
