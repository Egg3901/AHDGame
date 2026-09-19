// POST /api/country/[code]/executive/cabinet/[positionId]/debt-operation
// Auth: requireAuth — finance seat holder or admin. Costs 1 ministerial action.
// Launches a Debt Management Operation (accelerated investor-confidence recovery).
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getTreasuryOperationsCollection } from "@/lib/db/collections/treasuryOperations";
import {
  resolveFinancePosition,
  DEBT_OP_DURATION_TURNS,
  DEBT_OP_COOLDOWN_TURNS,
  DEBT_OP_CONFIDENCE_BOOST_PER_TURN,
} from "@/lib/constants/cabinetMonetary";

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (resolveFinancePosition(countryId) !== positionId) {
      return NextResponse.json({ error: "Not a finance cabinet position" }, { status: 404 });
    }

    const db = await getDb();
    const membersCol = getCabinetMembersCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the finance holder or admin can launch operations" },
        { status: 403 }
      );
    }

    // A debt operation reshapes the country's borrowing well past this tenure.
    const actingDenied = requireConfirmedSecretary(member, "treasury", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const opsCol = getTreasuryOperationsCollection(db);
    const existing = await opsCol.findOne({ _id: countryId });
    if (existing?.activeOp) {
      return NextResponse.json({ error: "An operation is already active" }, { status: 409 });
    }
    if (existing && currentTurn < existing.cooldownUntilTurn) {
      return NextResponse.json(
        { error: `On cooldown until turn ${existing.cooldownUntilTurn}` },
        { status: 409 }
      );
    }

    if (member && member.ministerialActions == null) {
      await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
      member.ministerialActions = 2;
    }
    const actions = member?.ministerialActions ?? 2;
    if (actions < 1) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 400 });
    }

    const spend = await membersCol.updateOne(
      { _id: member!._id, ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
    if (spend.modifiedCount === 0) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 409 });
    }

    const expiresTurn = currentTurn + DEBT_OP_DURATION_TURNS;
    const now = new Date();
    try {
      await opsCol.updateOne(
        { _id: countryId },
        {
          $set: {
            countryId,
            activeOp: {
              launchedTurn: currentTurn,
              expiresTurn,
              launchedBy: member!.characterId,
              launchedByName: member!.characterName,
              boostPerTurn: DEBT_OP_CONFIDENCE_BOOST_PER_TURN,
            },
            cooldownUntilTurn: expiresTurn + DEBT_OP_COOLDOWN_TURNS,
            updatedAt: now,
          },
          $setOnInsert: { history: [], createdAt: now },
        },
        { upsert: true }
      );
    } catch (error) {
      await membersCol.updateOne({ _id: member!._id }, { $inc: { ministerialActions: 1 } });
      throw error;
    }

    return NextResponse.json({ success: true, expiresTurn, actionsRemaining: actions - 1 });
  } catch (error) {
    return handleRouteError(error);
  }
}
