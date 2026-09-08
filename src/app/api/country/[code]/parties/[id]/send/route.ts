import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { sendFundsSchema } from "@/lib/api/schemas/send";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { findPartyBudgetForScope } from "@/lib/partyBudgetGuards";
import { wouldTriggerTreasuryReserveOverride } from "@/lib/partyTreasuryPlan";
import { isSameCountry } from "@/lib/api/sameCountry";
import { executeSendToMember } from "@/lib/treasury/executeSendToMember";
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

// POST /api/country/[code]/parties/[id]/send — Send funds from the national party treasury to a member character
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
//
// When the party's `transactionApprovalMode === "double"` (default
// post-2026-05-22), this endpoint writes a `pendingTreasuryTransactions`
// row with the proposer's slot pre-filled and returns `{ pending: true }`.
// The other approver fills the missing slot via the `/treasury/pending/
// [txnId]/approve` endpoint, which then executes the underlying
// transfer. Admin actions ALWAYS bypass the workflow (immediate
// execute).
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

    const parsed = await parseJsonBody(request, sendFundsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, amount: sendAmount } = parsed.data;
    const targetCharacterOid = parseObjectId(characterId);
    if (!targetCharacterOid) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const db = await getDb();

    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    // Check authorization: admin, chair, vice chair, or treasurer
    // Explicit null/undefined guard on chairId prevents null from ever satisfying the check
    const isAdmin = authUser.isAdmin;
    const isChair =
      !!party.chairId &&
      !!authUser.character &&
      party.chairId.toString() === authUser.character._id.toString();
    const isViceChair =
      !!party.viceChairId &&
      !!authUser.character &&
      party.viceChairId.toString() === authUser.character._id.toString();
    const isTreasurer =
      !!party.treasurerId &&
      !!authUser.character &&
      party.treasurerId.toString() === authUser.character._id.toString();

    if (!isAdmin && !isChair && !isViceChair && !isTreasurer) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Verify target character exists and is a party member in the same country
    const targetCharacter = await db.collection<Character>("characters").findOne({
      _id: targetCharacterOid,
    });

    if (!targetCharacter) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    if (targetCharacter.party !== partyIdStr || !isSameCountry(targetCharacter, { countryId })) {
      return NextResponse.json(
        { error: "Character is not a member of this party" },
        { status: 400 }
      );
    }

    // Check treasury balance (pre-check; the executor / pending row use
    // the same value at execute time via the `$gte` filter).
    const treasury = party.treasury ?? 0;
    if (treasury < sendAmount) {
      return NextResponse.json({ error: "Insufficient treasury funds" }, { status: 400 });
    }
    const budgetCollection = await getPartyBudgetCollection();
    const treasuryPlan = await findPartyBudgetForScope(budgetCollection, {
      countryId,
      partyId: partyIdStr,
      scope: "national",
    });
    // When the Treasurer seat is vacant the Chair / VC act as Treasurer
    // (see resolveTransactionApprovalMode), so they own the reserve target
    // and shouldn't be flagged for an "emergency override".
    const actsAsTreasurer = isTreasurer || (!party.treasurerId && (isChair || isViceChair));
    const reserveBreach = wouldTriggerTreasuryReserveOverride(treasury, sendAmount, treasuryPlan);
    const reserveWarning =
      reserveBreach && !actsAsTreasurer
        ? "Emergency override: send pierced the Treasurer reserve target."
        : null;

    // 2026-05-22 treasury-two-person-approval: branch on the party's
    // approval mode. Admin actions ALWAYS bypass the pending workflow
    // (admin already has bypass on most party actions). Non-admin
    // actions follow the party's configured mode; absent value (legacy
    // rows) is treated as "double". With no seated Treasurer, double
    // collapses to single (the Chair/VC act alone) so the action isn't
    // permanently locked.
    const mode = resolveTransactionApprovalMode(party);
    const isPlayerAction = !isAdmin;
    if (isPlayerAction && mode === "double") {
      const eligibility = canProposePendingTransaction(party);
      if (!eligibility.ok) {
        return NextResponse.json({ error: eligibility.reason }, { status: 400 });
      }
      // Proposer slot is decided by role. If the caller holds none of
      // the three approver roles the prior auth check would already have
      // rejected — getProposerSlot returning null here is defensive.
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
          type: "send",
          mode: "double",
          amount: sendAmount,
          targetCharacterId: targetCharacterOid,
        },
        currentTurn
      );
      return NextResponse.json({
        success: true,
        pending: true,
        transactionId: row._id.toString(),
        message: `Proposed $${sendAmount.toLocaleString()} to ${targetCharacter.name}. Awaiting second approver.`,
        warning: reserveWarning,
      });
    }

    // Immediate execution path (single mode or admin bypass).
    const result = await executeSendToMember({
      db,
      countryId,
      party,
      targetCharacter,
      amount: sendAmount,
      reserveWarning,
      initiator: { _id: authUser.character._id, name: authUser.character.name },
      initiatorUsername: authUser.username,
      initiatorUserId: authUser.userId,
    });
    return result.response;
  } catch (error) {
    return handleRouteError(error);
  }
}
