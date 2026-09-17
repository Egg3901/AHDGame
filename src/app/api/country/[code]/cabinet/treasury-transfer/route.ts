// POST /api/country/[code]/cabinet/treasury-transfer - Transfer federal surplus to CB FX reserve
// Auth: requireAuth - caller must hold the country's financeMinisterCabinetId seat (admin bypass)
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { TREASURY_TRANSFER_MAX_PER_TURN_FRACTION } from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types";
import type { TreasuryTransferRecord } from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import { effectiveBorrowingLimit } from "@/lib/budget/borrowingLimit";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  applyTreasuryTransferSpend,
  TreasuryTransferBusyError,
} from "@/lib/centralBank/treasuryTransferSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { getGameState } from "@/lib/gameState";
import { getBankId } from "@/lib/centralBank/helpers";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  amount: z.number().positive(),
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

    const budgetId = countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    if (!budget) throw notFound("Federal budget not found");

    const annualRevenue = budget.revenue?.total ?? 0;
    const perTurnCap = annualRevenue * TREASURY_TRANSFER_MAX_PER_TURN_FRACTION;
    if (parsed.data.amount > perTurnCap) {
      throw badRequest(
        `Transfer exceeds per-turn cap (${TREASURY_TRANSFER_MAX_PER_TURN_FRACTION * 100}% of annual revenue = ${perTurnCap.toFixed(0)}).`
      );
    }

    const debtCeiling = effectiveBorrowingLimit({
      countryId,
      gdp: budget.gdpSmoothed ?? budget.gdp,
      storedCeiling: budget.debt?.ceiling ?? 0,
    });
    // Derived, not read: `surplus` is a cache that drifts between turns' writers, and
    // this gates a player's transfer against the debt ceiling. A stale cache here either
    // blocks a legal transfer or waves through one that breaches the ceiling.
    if (
      typeof debtCeiling === "number" &&
      federalSurplus(budget) - parsed.data.amount < -debtCeiling
    ) {
      throw badRequest("Transfer would breach the federal debt ceiling.");
    }

    const bankId = getBankId(countryId);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank) throw notFound("Central bank not found");

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const now = new Date();
    const record: TreasuryTransferRecord = {
      turn: currentTurn,
      transferredBy: myChar._id ?? new ObjectId(auth.user.userId),
      transferredByName: myChar.name ?? auth.user.username ?? "Unknown",
      amount: parsed.data.amount,
      ...(parsed.data.justification ? { justification: parsed.data.justification } : {}),
      createdAt: now,
    };

    // Crash-safe spend (issue #1672): the budget debit is a keyed idempotent
    // leg and the reserve credit, history push, and mutex release are one
    // atomic keyed write, so a crash between the sequential writes reconciles
    // instead of debiting a surplus that never lands. `Idempotency-Key`
    // replays the stored outcome without moving money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }
    try {
      await applyTreasuryTransferSpend(db, {
        budgetId,
        bankId,
        amount: parsed.data.amount,
        ...(typeof debtCeiling === "number" ? { debtCeiling } : {}),
        currentTurn,
        isAdmin,
        record,
        fingerprint: `${countryId}:${budgetId}:${parsed.data.amount}:${currentTurn}:${record.transferredBy.toHexString()}`,
        idempotencyKey: headerKey ?? randomUUID(),
      });
    } catch (error) {
      if (error instanceof TreasuryTransferBusyError) {
        throw badRequest("Only one treasury transfer per turn is permitted.");
      }
      if (
        error instanceof Error &&
        error.message === "Transfer would breach the federal debt ceiling."
      ) {
        throw badRequest("Transfer would breach the federal debt ceiling.");
      }
      if (error instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "Transfer already settled; start a new attempt with a new key." },
          { status: 409 }
        );
      }
      if (error instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "Idempotency key was reused for a different transfer." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, transferred: parsed.data.amount, record });
  } catch (error) {
    return handleRouteError(error);
  }
}
