// POST /api/country/[code]/executive/cabinet/[positionId]/debt-operation
// Auth: requireAuth — finance seat holder or admin. Costs 1 ministerial action.
// Launches a Debt Management Operation (accelerated investor-confidence recovery).
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  refundMinisterialAction,
  resolveMinisterialRemaining,
  spendMinisterialAction,
} from "@/lib/cabinet/ministerialActionPool";
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
      return errorResponse(400, "Invalid country");
    }
    if (resolveFinancePosition(countryId) !== positionId) {
      return errorResponse(404, "Not a finance cabinet position");
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
      return errorResponse(403, "Only the finance holder or admin can launch operations");
    }

    // A debt operation reshapes the country's borrowing well past this tenure.
    const actingDenied = requireConfirmedSecretary(member, "treasury", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const opsCol = getTreasuryOperationsCollection(db);
    const existing = await opsCol.findOne({ _id: countryId });
    if (existing?.activeOp) {
      return errorResponse(409, "An operation is already active");
    }
    if (existing && currentTurn < existing.cooldownUntilTurn) {
      return errorResponse(409, `On cooldown until turn ${existing.cooldownUntilTurn}`);
    }

    // Shared UK pool: both offices of a dual holder spend one balance (issue #2049).
    const actions = await resolveMinisterialRemaining(db, countryId, member!);
    if (actions < 1) {
      return errorResponse(400, "No ministerial actions remaining");
    }

    const spend = await spendMinisterialAction(db, countryId, member!);
    if (!spend.ok) {
      return errorResponse(409, "No ministerial actions remaining");
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
      await refundMinisterialAction(db, countryId, member!);
      throw error;
    }

    return NextResponse.json({ success: true, expiresTurn, actionsRemaining: spend.remaining });
  } catch (error) {
    return handleRouteError(error);
  }
}
