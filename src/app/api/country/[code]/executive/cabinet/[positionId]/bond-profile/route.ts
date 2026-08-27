// POST /api/country/[code]/executive/cabinet/[positionId]/bond-profile
// Auth: requireAuth — must be finance minister holder or admin
// Errors: 400, 401, 403, 404
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameState } from "@/lib/gameState";
import { SOVEREIGN_BOND_MATURITY_ADMIN_OPTIONS } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";

const bondProfileSchema = z.record(z.string(), z.number().min(0).max(1)).refine(
  (dist) => {
    const keys = Object.keys(dist).map(Number);
    if (keys.some((k) => !SOVEREIGN_BOND_MATURITY_ADMIN_OPTIONS.includes(k as BondMaturityTurns)))
      return false;
    const total = Object.values(dist).reduce((s, v) => s + v, 0);
    return Math.abs(total - 1) < 0.001;
  },
  {
    message: "distribution keys must be valid maturity turns (48/96/240) and values must sum to 1",
  }
);

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!config.financeMinisterCabinetId) {
      return NextResponse.json(
        { error: "Bond profile is not configured for this country" },
        { status: 400 }
      );
    }
    if (positionId !== config.financeMinisterCabinetId) {
      return NextResponse.json(
        { error: "This position does not control sovereign bond profile" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, bondProfileSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const myChar = auth.user.character;
    if (!myChar) {
      return NextResponse.json({ error: "Character required" }, { status: 403 });
    }

    const isAdmin = auth.user.isAdmin === true;
    if (!isAdmin) {
      const member = await getCabinetMembersCollection(db).findOne({
        countryId,
        positionId: config.financeMinisterCabinetId,
        characterId: new ObjectId(myChar._id),
      });
      if (!member) {
        return NextResponse.json(
          {
            error: `Only the ${config.financeMinisterCabinetId} for ${countryId} can set the bond profile`,
          },
          { status: 403 }
        );
      }
      // The maturity mix decides what the country owes and when, for up to 240
      // turns. The admin arm above never reaches here, which is the exemption.
      const actingDenied = requireConfirmedSecretary(member, "treasury");
      if (actingDenied) return actingDenied;
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;
    const budgetId = getNationalBudgetId(countryId);
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    if (!budget) {
      return NextResponse.json({ error: "Federal budget not found" }, { status: 404 });
    }

    // Rate limit: once per 24 turns (same as generic cabinet settings)
    const lastChangedTurn = budget.sovereignBondProfileLastChangedTurn ?? 0;
    if (!isAdmin && currentTurn - lastChangedTurn < 24) {
      const turnsRemaining = 24 - (currentTurn - lastChangedTurn);
      return NextResponse.json(
        {
          error: `Bond profile can only be changed once per 24 turns. ${turnsRemaining} turns remaining.`,
        },
        { status: 400 }
      );
    }

    // Convert string keys from JSON to BondMaturityTurns numbers.
    const distribution = Object.fromEntries(
      Object.entries(parsed.data).map(([k, v]) => [Number(k) as BondMaturityTurns, v])
    ) as Partial<Record<BondMaturityTurns, number>>;

    const now = new Date();
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budgetId },
      {
        $set: {
          sovereignBondProfile: distribution,
          sovereignBondProfileLastChangedTurn: currentTurn,
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      success: true,
      sovereignBondProfile: distribution,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
