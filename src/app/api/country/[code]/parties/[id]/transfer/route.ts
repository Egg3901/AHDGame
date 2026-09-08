import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { partyTransferSchema } from "@/lib/api/schemas/settings";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { State } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { findPartyBudgetForScope } from "@/lib/partyBudgetGuards";
import { wouldTriggerTreasuryReserveOverride } from "@/lib/partyTreasuryPlan";
import { executeTransferToStateParty } from "@/lib/treasury/executeTransferToStateParty";
import {
  canProposePendingTransaction,
  createPendingTransaction,
  getProposerSlot,
  resolveTransactionApprovalMode,
} from "@/lib/parties/pendingTreasuryTransactions";
import { getGameTime } from "@/lib/time/gameTime";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/transfer — Transfer funds from the national party treasury to a state party
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
//
// Same approval-mode branching as `/send`: writes a pending row in
// "double" mode, executes immediately in "single" mode or for admin
// callers. See 2026-05-22 treasury-two-person-approval scope doc.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = authResult.user;

    const parsed = await parseJsonBody(request, partyTransferSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { stateId, amount } = parsed.data;
    const upperStateId = stateId.toUpperCase();

    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    // Verify user is the national chair, vice chair, treasurer, or admin
    const isAdmin = authUser.isAdmin;
    const isChair = party.chairId?.equals(authUser.character._id);
    const isViceChair = party.viceChairId?.equals(authUser.character._id);
    const isTreasurer = party.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isChair && !isViceChair && !isTreasurer) {
      return NextResponse.json(
        { error: "Only the party chair, vice chair, treasurer, or an admin can transfer funds" },
        { status: 403 }
      );
    }

    // Verify state exists and belongs to this country (prevents cross-country IDs).
    const state = await db.collection<State>("states").findOne({
      _id: upperStateId,
      countryId,
    });
    if (!state) {
      return NextResponse.json({ error: "Region not found" }, { status: 404 });
    }

    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    // Check treasury balance (pre-check).
    const treasury = party.treasury ?? 0;
    if (amount > treasury) {
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: $${treasury.toLocaleString()}` },
        { status: 400 }
      );
    }
    const budgetCollection = await getPartyBudgetCollection();
    const treasuryPlan = await findPartyBudgetForScope(budgetCollection, {
      countryId,
      partyId: partyIdStr,
      scope: "national",
    });
    // With no seated Treasurer the Chair / VC act as Treasurer and own the
    // reserve target, so they aren't flagged for an "emergency override".
    const actsAsTreasurer = isTreasurer || (!party.treasurerId && (isChair || isViceChair));
    const reserveBreach = wouldTriggerTreasuryReserveOverride(treasury, amount, treasuryPlan);
    const reserveWarning =
      reserveBreach && !actsAsTreasurer
        ? "Emergency override: transfer pierced the Treasurer reserve target."
        : null;

    // 2026-05-22 treasury-two-person-approval branch. With no seated
    // Treasurer, double collapses to single so the Chair/VC act alone.
    const mode = resolveTransactionApprovalMode(party);
    const isPlayerAction = !isAdmin;
    if (isPlayerAction && mode === "double") {
      const eligibility = canProposePendingTransaction(party);
      if (!eligibility.ok) {
        return NextResponse.json({ error: eligibility.reason }, { status: 400 });
      }
      const slot = getProposerSlot(party, authUser.character._id);
      if (slot == null) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
      const { currentTurn } = await getGameTime();
      const row = await createPendingTransaction(
        db,
        {
          party,
          proposerCharacterId: authUser.character._id,
          type: "transfer",
          mode: "double",
          amount,
          targetStateId: upperStateId,
        },
        currentTurn
      );
      return NextResponse.json({
        success: true,
        pending: true,
        transactionId: row._id.toString(),
        message: `Proposed $${amount.toLocaleString()} to ${state.name} ${party.name}. Awaiting second approver.`,
        warning: reserveWarning,
      });
    }

    const result = await executeTransferToStateParty({
      db,
      countryId,
      party,
      state,
      amount,
      reserveWarning,
      initiator: { _id: authUser.character._id, name: authUser.character.name },
      initiatorUsername: authUser.username,
      initiatorUserId: authUser.userId,
      isAdmin: !!isAdmin,
    });
    return result.response;
  } catch (error) {
    return handleRouteError(error);
  }
}
