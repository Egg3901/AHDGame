import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { getGameTime } from "@/lib/time/gameTime";
import { executeSendToMember } from "@/lib/treasury/executeSendToMember";
import { executeTransferToStateParty } from "@/lib/treasury/executeTransferToStateParty";
import {
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
// Auth: must be the missing-slot's eligible role (Treasurer if
// treasurerApproval is unfilled; Chair OR Vice-Chair if leadership
// is unfilled). The atomic update guards on `status: "open"` AND on
// the slot being empty, so double-clicks and races are no-ops, not
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
            : "Only an officer (Treasurer / Chair / Vice-Chair) can approve treasury transactions.",
        },
        { status: 403 }
      );
    }

    const slotField = slot === "treasurer" ? "treasurerApproval" : "leadershipApproval";
    const alreadyFilled =
      slot === "treasurer" ? !!pending.treasurerApproval : !!pending.leadershipApproval;
    if (alreadyFilled) {
      return NextResponse.json(
        { error: `The ${slot === "treasurer" ? "Treasurer" : "Chair/VC"} slot is already filled.` },
        { status: 400 }
      );
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

    // ─── Execute the underlying transfer ─────────────────────────────────
    // Treasurer co-signed by definition (they're either the approver
    // we just recorded OR they pre-approved at propose-time), so the
    // reserve-warning rule "reserve breach && !isTreasurer" is by
    // construction false — pass null.
    const reserveWarning: string | null = null;

    if (ready.type === "send" || ready.type === "request") {
      // Both flows execute via the same send-to-member path — for
      // "request" the recipient is the proposer themselves.
      if (!ready.targetCharacterId) {
        return NextResponse.json(
          { error: "Pending row missing target character" },
          { status: 500 }
        );
      }
      const targetCharacter = await db
        .collection<Character>("characters")
        .findOne({ _id: ready.targetCharacterId });
      if (!targetCharacter) {
        return NextResponse.json(
          { error: "Recipient character no longer exists." },
          { status: 404 }
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
      });
      if (!result.ok) return result.response;
    } else if (ready.type === "transfer") {
      if (!ready.targetStateId) {
        return NextResponse.json({ error: "Pending row missing target state" }, { status: 500 });
      }
      const state = await db
        .collection<State>("states")
        .findOne({ _id: ready.targetStateId, countryId });
      if (!state) {
        return NextResponse.json({ error: "Region no longer exists." }, { status: 404 });
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
      if (!result.ok) return result.response;
    } else {
      return NextResponse.json(
        { error: `Unknown pending txn type: ${ready.type}` },
        { status: 500 }
      );
    }

    // ─── Mark the pending row approved ───────────────────────────────────
    const { currentTurn } = await getGameTime();
    await db
      .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
      .updateOne(
        { _id: txnOid },
        { $set: { status: "approved", resolvedAt: now, resolvedAtTurn: currentTurn } }
      );

    return NextResponse.json({ success: true, status: "approved" });
  } catch (error) {
    return handleRouteError(error);
  }
}
