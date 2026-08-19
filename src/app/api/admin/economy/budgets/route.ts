// GET /api/admin/economy/budgets?countryId=US&fiscalYear=2021
// Returns FederalBudget + prime rate + turns-until-FY. Historical snapshot when fiscalYear is set.
// Auth: requireAdmin
// Errors: 403, 400, 404
//
// **Currency (v0.2.6):** Scoped to one country per query, so every money field
// in the response is in that country's currency. `currencyCode` is surfaced at
// the top level for both live and snapshot paths; for pre-v0.2.6 snapshots that
// lack `budget.currencyCode`, we derive from the requested countryId.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { FISCAL_YEAR_START_TURN_IN_YEAR } from "@/lib/budget/fiscalYear";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { z } from "zod";
import type { FederalBudget, FederalBudgetSnapshot } from "@/lib/db/types/budget";
import type { CentralBank, GameState } from "@/lib/db/types";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";

const querySchema = z.object({
  countryId: countryIdSchema,
  fiscalYear: z.coerce.number().int().positive().optional(),
});

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      countryId: searchParams.get("countryId"),
      fiscalYear: searchParams.get("fiscalYear") || undefined,
    });
    if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

    const { countryId, fiscalYear } = parsed.data;
    const budgetId = countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;

    const db = await getDb();

    // Always fetch available FY snapshots for the dropdown
    const snapshots = await db
      .collection<FederalBudgetSnapshot>("federalBudgetSnapshots")
      .find({ countryId }, { projection: { fiscalYear: 1 } })
      .toArray();
    const availableFiscalYears = snapshots.map((s) => s.fiscalYear).sort((a, b) => b - a);

    // Historical snapshot request
    if (fiscalYear) {
      const snapshot = await db
        .collection<FederalBudgetSnapshot>("federalBudgetSnapshots")
        .findOne({ _id: `${countryId}:FY${fiscalYear}` });
      if (!snapshot) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

      return NextResponse.json({
        budget: {
          ...snapshot.budget,
          _id: budgetId,
          countryId: snapshot.countryId,
          fiscalYear: snapshot.fiscalYear,
          updatedAt: snapshot.createdAt,
        },
        currencyCode:
          snapshot.budget.currencyCode ??
          resolveCountryCurrencyCode({ countryId: snapshot.countryId }),
        primeRate: 0,
        currentTurn: snapshot.turn,
        turnsUntilFY: 0,
        isSnapshot: true,
        snapshotFiscalYear: snapshot.fiscalYear,
        availableFiscalYears,
      });
    }

    // Live budget request
    const [budget, gameState, centralBank] = await Promise.all([
      db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
      db
        .collection<CentralBank>("centralBanks")
        .findOne({ countryId }, { projection: { primeRate: 1 } }),
    ]);

    if (!budget) return NextResponse.json({ error: "Budget not found" }, { status: 404 });

    const currentTurn = gameState?.currentTurn ?? 0;
    const turnInYear = ((currentTurn - 1) % TURNS_PER_YEAR) + 1;
    const rawTurnsUntilFY = FISCAL_YEAR_START_TURN_IN_YEAR - turnInYear;
    const turnsUntilFY = rawTurnsUntilFY <= 0 ? rawTurnsUntilFY + TURNS_PER_YEAR : rawTurnsUntilFY;

    return NextResponse.json({
      budget,
      currencyCode: budget.currencyCode ?? resolveCountryCurrencyCode({ countryId }),
      primeRate: centralBank?.primeRate ?? 0,
      currentTurn,
      turnsUntilFY,
      isSnapshot: false,
      availableFiscalYears,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
