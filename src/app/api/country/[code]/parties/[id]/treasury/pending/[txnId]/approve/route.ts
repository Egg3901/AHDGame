import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import {
  isLeadershipElectionFreezeActive,
  LEADERSHIP_FREEZE_MESSAGE,
} from "@/lib/parties/leadershipElectionFreeze";
import { getGameTime } from "@/lib/time/gameTime";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { findPartyBudgetForScope } from "@/lib/partyBudgetGuards";
import { wouldTriggerTreasuryReserveOverride } from "@/lib/partyTreasuryPlan";
import { executeSendToMember } from "@/lib/treasury/executeSendToMember";
import { isTreasuryExecutionUncertain } from "@/lib/treasury/executionUncertain";
import { executeTransferToStateParty } from "@/lib/treasury/executeTransferToStateParty";
import {
  approvalFieldForSlot,
  getApproverSlotForRow,
  isPendingTransactionComplete,
} from "@/lib/parties/pendingTreasuryTransactions";
import type { Character, PendingTreasuryTransaction, State } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string; txnId: string }>;
}

// POST /api/country/[code]/parties/[id]/treasury/pending/[txnId]/approve
// Fills the missing approval slot on a pending treasury transaction
// and executes the underlying transfer in one flow.
//
// Auth: any officer of the party (Chair, Vice-Chair or Treasurer) who
// has not already signed this row, and who is not the requester of a
// Request Funds row. Slots are filled in order and are not tied to a
// seat. The atomic update guards on `status: "open"` AND on the slot
// being empty, so double-clicks and races are no-ops, not
// double-executes.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId, txnId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const { user } = authResult;

    const rateLimit = checkRateLimit(user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    let txnOid: ObjectId;
    try {
      txnOid = new ObjectId(txnId);
    } catch {
      return NextResponse.json({ error: "Invalid transaction ID" }, { status: 400 });
    }

    const db = await getDb();

    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const pending = await db
      .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
      .findOne({ _id: txnOid });
    if (!pending) {
      return NextResponse.json({ error: "Pending transaction not found" }, { status: 404 });
    }
    if (!pending.partyId.equals(party._id) || pending.countryId !== countryId) {
      return NextResponse.json(
        { error: "Transaction does not belong to this party" },
        { status: 403 }
      );
    }
    if (pending.status !== "open") {
      return NextResponse.json(
        { error: `Transaction is ${pending.status}, not open.` },
        { status: 400 }
      );
    }

    // A row queued before the leadership handover window must not pay out
    // during it. Checked before the slot claim so a refusal does not
    // leave the row carrying an approval that never executed.
    const { currentTurn: freezeTurn } = await getGameTime();
    if (await isLeadershipElectionFreezeActive(db, party, freezeTurn)) {
      return NextResponse.json({ error: LEADERSHIP_FREEZE_MESSAGE }, { status: 400 });
    }

    // Resolve which slot this character would fill on this row.
    // Self-approval exclusion for Request Funds is enforced inside the
    // helper — requester returns null even if they hold a seat.
    const characterId = user.character._id;
    const slot = getApproverSlotForRow(party, pending, characterId);
    if (slot == null) {
      const isSelfRequest = pending.type === "request" && pending.proposedBy.equals(characterId);
      return NextResponse.json(
        {
          error: isSelfRequest
            ? "You can't approve your own Request Funds."
            : "Only an officer (Treasurer / Chair / Vice-Chair) who has not already signed this transaction can approve it.",
        },
        { status: 403 }
      );
    }

    const slotField = approvalFieldForSlot(slot);
    const alreadyFilled = !!pending[slotField];
    if (alreadyFilled) {
      return NextResponse.json({ error: "That approval slot is already filled." }, { status: 400 });
    }

    // ─── Fill the matching slot atomically ───────────────────────────────
    const now = new Date();
    const claim = await db
      .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
      .updateOne(
        // Guard: status still open, slot still empty. If another approver
        // beat us here (or a cancel landed), the update is a no-op.
        //
        // Slot "empty" means either the field is missing OR explicitly null.
        // Legacy rows written before the conditional-spread fix in
        // createPendingTransaction stored `treasurerApproval: undefined`,
        // which the mongodb driver serializes as BSON null
        // (ignoreUndefined defaults to false). Accept both shapes so
        // those rows remain approvable without a migration.
        {
          _id: txnOid,
          status: "open",
          $or: [{ [slotField]: { $exists: false } }, { [slotField]: null }],
        },
        { $set: { [slotField]: { characterId, approvedAt: now } } }
      );
    if (claim.matchedCount === 0) {
      return NextResponse.json(
        { error: "Transaction is no longer available to approve." },
        { status: 409 }
      );
    }

    /**
     * Hand the slot back on ANY failure exit below.
     *
     * The claim above is deliberately written BEFORE the execute, so two
     * approvers racing cannot both execute. The cost is that a refusal
     * further down used to leave the signature behind on a still-open
     * row: the panel then showed a transaction that looked approved,
     * every further Approve click burned the other slot the same way,
     * and the row sat there until the expiry sweep took it 48 turns
     * later. Releasing restores exactly the state the approver clicked
     * from, so a refusal is a refusal and not a corrupted row.
     */
    const releaseClaimedSlot = async (): Promise<void> => {
      await db.collection<PendingTreasuryTransaction>("pendingTreasuryTransactions").updateOne(
        // Guarded on "executing", the state this request put the row
        // into. A row that is no longer executing is not ours to
        // reopen.
        { _id: txnOid, status: "executing" },
        { $unset: { [slotField]: "", executingAt: "" }, $set: { status: "open" } }
      );
    };
    const releaseSlot = async (response: NextResponse): Promise<NextResponse> => {
      await releaseClaimedSlot();
      return response;
    };

    // Re-fetch and check completion (mode-aware: request+single may
    // complete on a single slot fill; send/transfer always require both).
    const ready = await db
      .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
      .findOne({ _id: txnOid });
    if (!ready || ready.status !== "open") {
      return NextResponse.json(
        { error: "Transaction state changed unexpectedly." },
        { status: 409 }
      );
    }

    // For double-mode Request when only one slot is filled, the row is
    // accepted but not yet executable. Stop here — the other approver
    // closes it on their click.
    if (!isPendingTransactionComplete(ready)) {
      return NextResponse.json({
        success: true,
        pending: true,
        status: "open",
        message: "Approval recorded. Waiting on the second approver.",
      });
    }

    // ─── Reserve-target override ─────────────────────────────────────────
    // Same rule the direct send/transfer routes apply: piercing the
    // Treasurer's reserve target is allowed, but it is recorded as an
    // emergency override unless the Treasurer is the one doing it.
    //
    // This used to be hardcoded null on the grounds that the Treasurer
    // co-signed every completed row by definition. Once any two officers
    // can complete one, that stopped being true: a Chair and a
    // Vice-Chair can now empty the reserve with nothing in the admin log
    // to say so.
    const budgetCollection = await getPartyBudgetCollection();
    const treasuryPlan = await findPartyBudgetForScope(budgetCollection, {
      countryId,
      partyId: String(party.sequentialId),
      scope: "national",
    });
    // A vacant Treasurer seat makes the Chair/VC the reserve target's
    // owners (see resolveTransactionApprovalMode), so they are not
    // overriding anyone — this mirrors `actsAsTreasurer` in the send and
    // transfer routes.
    const treasurerSigned =
      !party.treasurerId ||
      [ready.treasurerApproval?.characterId, ready.leadershipApproval?.characterId].some(
        (id) => !!id && party.treasurerId!.equals(id)
      );
    const reserveWarning: string | null =
      !treasurerSigned &&
      wouldTriggerTreasuryReserveOverride(party.treasury ?? 0, ready.amount, treasuryPlan)
        ? ready.type === "transfer"
          ? "Emergency override: transfer pierced the Treasurer reserve target."
          : "Emergency override: send pierced the Treasurer reserve target."
        : null;

    // ─── Claim the row for execution ─────────────────────────────────────
    // Having enough signatures is not the same event as paying out, and
    // this flip is the only thing that separates them. Two approvers
    // filling the two DIFFERENT slots both pass the `$exists: false`
    // slot guard, and both then re-read a row that is complete — so
    // before this, both went on to execute and the treasury paid twice.
    // The `status: "open"` guard makes exactly one of them the winner.
    const executionClaim = await db
      .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
      .updateOne(
        { _id: txnOid, status: "open" },
        { $set: { status: "executing", executingAt: now } }
      );
    if (executionClaim.matchedCount === 0) {
      // Our signature is a real one either way, so it stays put —
      // releasing here would pull a signature out from under a transfer
      // already in flight.
      //
      // But "we lost the race" is only one reason the flip can miss.
      // A cancel or the expiry sweep can take the row between the slot
      // claim and here, and telling that player to wait for another
      // approver sends them to wait for a payout that is never coming.
      // Only cancelled and expired are reported as failures: they are
      // the states that mean no payout is coming. Anything else is
      // either the winner at work or a transient read, and the approval
      // was genuinely recorded, so there is nothing to alarm about.
      const current = await db
        .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
        .findOne({ _id: txnOid });
      if (current?.status === "cancelled" || current?.status === "expired") {
        return NextResponse.json(
          { error: `Transaction is ${current.status}, not open.` },
          { status: 400 }
        );
      }
      return NextResponse.json({
        success: true,
        pending: false,
        message: "Approval recorded. Another approver is completing this transaction.",
      });
    }

    // ─── Execute the underlying transfer ─────────────────────────────────
    // Needed both for the recipient's per-turn payout cap and for
    // stamping the row resolved below.
    const { currentTurn } = await getGameTime();

    try {
      if (ready.type === "send" || ready.type === "request") {
        // Both flows execute via the same send-to-member path — for
        // "request" the recipient is the proposer themselves.
        if (!ready.targetCharacterId) {
          return releaseSlot(
            NextResponse.json({ error: "Pending row missing target character" }, { status: 500 })
          );
        }
        const targetCharacter = await db
          .collection<Character>("characters")
          .findOne({ _id: ready.targetCharacterId });
        if (!targetCharacter) {
          return releaseSlot(
            NextResponse.json({ error: "Recipient character no longer exists." }, { status: 404 })
          );
        }
        const result = await executeSendToMember({
          db,
          countryId,
          party,
          targetCharacter,
          amount: ready.amount,
          reserveWarning,
          initiator: { _id: user.character._id, name: user.character.name },
          initiatorUsername: user.username,
          initiatorUserId: user.userId,
          currentTurn,
        });
        if (!result.ok) return releaseSlot(result.response);
      } else if (ready.type === "transfer") {
        if (!ready.targetStateId) {
          return releaseSlot(
            NextResponse.json({ error: "Pending row missing target state" }, { status: 500 })
          );
        }
        const state = await db
          .collection<State>("states")
          .findOne({ _id: ready.targetStateId, countryId });
        if (!state) {
          return releaseSlot(
            NextResponse.json({ error: "Region no longer exists." }, { status: 404 })
          );
        }
        const result = await executeTransferToStateParty({
          db,
          countryId,
          party,
          state,
          amount: ready.amount,
          reserveWarning,
          initiator: { _id: user.character._id, name: user.character.name },
          initiatorUsername: user.username,
          initiatorUserId: user.userId,
          isAdmin: !!user.isAdmin,
        });
        if (!result.ok) return releaseSlot(result.response);
      } else {
        return releaseSlot(
          NextResponse.json({ error: `Unknown pending txn type: ${ready.type}` }, { status: 500 })
        );
      }
    } catch (executionError) {
      // A throw strands the signature exactly as a refusal would, so the
      // slot goes back before the error continues to the route handler.
      // A failure to release must not replace the failure that caused
      // it: the original is the one worth reporting.
      //
      // UNLESS the executor says the treasury may already be debited.
      // Production Mongo is standalone, so the executors debit and
      // credit sequentially with no transaction to roll back; when the
      // credit fails AND the compensating refund fails, the money is
      // gone. Reopening the row there would put a free slot back on a
      // transaction that has already spent funds. It stays `executing`
      // for an operator instead.
      if (!isTreasuryExecutionUncertain(executionError)) {
        try {
          await releaseClaimedSlot();
        } catch {
          // Swallowed deliberately; `executionError` is rethrown below.
        }
      }
      throw executionError;
    }

    // ─── Mark the pending row approved ───────────────────────────────────
    // The money has moved. If this stamp fails the row stays
    // "executing" — never back to "open", which would leave a free slot
    // one Approve click away from spending the same funds again.
    await db.collection<PendingTreasuryTransaction>("pendingTreasuryTransactions").updateOne(
      { _id: txnOid, status: "executing" },
      {
        $set: { status: "approved", resolvedAt: now, resolvedAtTurn: currentTurn },
        $unset: { executingAt: "" },
      }
    );

    return NextResponse.json({ success: true, status: "approved" });
  } catch (error) {
    return handleRouteError(error);
  }
}
