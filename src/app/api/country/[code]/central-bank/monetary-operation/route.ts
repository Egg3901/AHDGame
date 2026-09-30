import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getBankId, getMonetaryPolicyScope } from "@/lib/centralBank/helpers";
import type { CentralBank, FederalBudget, GameConfig } from "@/lib/db/types";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import {
  DIRECT_ADVANCE_GDP_CAP,
  executeMonetaryOperation,
  LIQUIDITY_INJECTION_GDP_CAP,
  MONETARY_OPERATION_COOLDOWN_TURNS,
} from "@/lib/moneySupply/operations";
import {
  existingLiquidityAdvance,
  LiquidityAdvanceRejected,
} from "@/lib/moneySupply/liquidityAdvance";
import {
  existingMonetaryOperation,
  MonetaryOperationRejected,
} from "@/lib/moneySupply/monetaryOperationJournal";
import { snapshotMoneySupply } from "@/lib/moneySupply/snapshot";
import { isMoneySupplyEnabledFromConfig } from "@/lib/moneySupply/featureFlag";

const schema = z.object({
  type: z.enum(["qe", "qt", "treasury_advance", "liquidity_injection"]),
  amount: z.number().positive().optional(),
  bondId: z.string().optional(),
  units: z.number().int().positive().optional(),
  reason: z.string().trim().max(240).optional(),
  operationId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{8,128}$/)
    .optional(),
});

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const countryId = (await context.params).code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json({ error: "Country not found" }, { status: 404 });
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const db = await getDb();
    const [bank, gameState, budget, config] = await Promise.all([
      db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }),
      getGameState(db),
      db
        .collection<FederalBudget>("federalBudget")
        .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }),
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { moneySupplyEnabled: 1 } }),
    ]);
    if (!isMoneySupplyEnabledFromConfig(config))
      return NextResponse.json({ error: "Money-supply policy is not enabled" }, { status: 409 });
    if (!bank || !budget)
      return NextResponse.json({ error: "Monetary authority unavailable" }, { status: 404 });
    const scope = await getMonetaryPolicyScope(db, countryId);
    const authority =
      scope.bankId === bank._id
        ? bank
        : await db
            .collection<CentralBank>("centralBanks")
            .findOne(
              { _id: scope.bankId },
              { projection: { chairCharacterId: 1, chairControlsLocked: 1 } }
            );
    const isChair =
      auth.user.character?._id != null &&
      authority?.chairCharacterId?.toString() === auth.user.character._id.toString();
    if (!auth.user.isAdmin && (!isChair || authority?.chairControlsLocked))
      return NextResponse.json({ error: "Only the central-bank chair may act" }, { status: 403 });
    const turn = gameState?.currentTurn ?? 0;
    const replay =
      parsed.data.type === "liquidity_injection" && parsed.data.operationId
        ? await existingLiquidityAdvance(db, {
            operationId: parsed.data.operationId,
            countryId,
            amount: Math.max(0, Math.floor(parsed.data.amount ?? 0)),
            reason: parsed.data.reason,
          })
        : await existingMonetaryOperation(db, {
            ...parsed.data,
            countryId,
            turn,
            actorName: auth.user.character?.name ?? auth.user.username,
          });
    if (
      !auth.user.isAdmin &&
      !replay &&
      bank.lastMonetaryOperationTurn != null &&
      turn - bank.lastMonetaryOperationTurn < MONETARY_OPERATION_COOLDOWN_TURNS
    )
      return NextResponse.json({ error: "Monetary operations are on cooldown" }, { status: 409 });
    const amount = parsed.data.amount ?? 0;
    const cap =
      parsed.data.type === "treasury_advance"
        ? budget.gdp * DIRECT_ADVANCE_GDP_CAP
        : budget.gdp * LIQUIDITY_INJECTION_GDP_CAP;
    if (
      !auth.user.isAdmin &&
      !replay &&
      (parsed.data.type === "treasury_advance" || parsed.data.type === "liquidity_injection") &&
      amount > cap
    )
      return NextResponse.json(
        { error: `Operation exceeds the ${Math.round(cap)} cap` },
        { status: 400 }
      );
    const operation = await executeMonetaryOperation(db, {
      countryId,
      operationId: parsed.data.operationId,
      bypassCooldown: auth.user.isAdmin,
      type: parsed.data.type,
      turn,
      actorName: auth.user.character?.name ?? auth.user.username,
      reason: parsed.data.reason,
      amount,
      bondId: parsed.data.bondId,
      units: parsed.data.units,
    });
    await snapshotMoneySupply(db, turn);
    return NextResponse.json({ success: true, operation });
  } catch (error) {
    if (error instanceof LiquidityAdvanceRejected || error instanceof MonetaryOperationRejected)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return handleRouteError(error);
  }
}
