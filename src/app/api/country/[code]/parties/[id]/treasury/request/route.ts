import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { requestFundsSchema } from "@/lib/api/schemas/requestFunds";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getGameTime } from "@/lib/time/gameTime";
import {
  canRequestFunds,
  createPendingTransaction,
  resolveTransactionApprovalMode,
} from "@/lib/parties/pendingTreasuryTransactions";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/treasury/request
// Auth: requireAuthWithCharacter; must be a member of THIS party
// Errors: 400, 401, 403, 404, 429
//
// Member-initiated Request Funds. Always writes a
// pendingTreasuryTransactions row (no immediate-execute path); the
// approval-completion count varies with the party's current
// `transactionApprovalMode`:
//   - "single": one approver from {Treasurer, Chair, VC} satisfies it
//   - "double": Treasurer + (Chair OR VC) — same as send/transfer
//
// The requester NEVER auto-fills any slot, even if they hold an
// officer seat (no auto-approvals for Request Funds — user-confirmed
// 2026-05-23 spec). The pending row's `approvalModeAtPropose` records
// the mode so the row finishes under the original rules even if the
// party toggles modes mid-flight.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
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

    const rateLimit = checkRateLimit(user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, requestFundsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount, note } = parsed.data;

    const db = await getDb();

    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // Membership check — the requester must be in this party.
    const partyIdStr = String(party.sequentialId);
    if (user.character.party !== partyIdStr || !isSameCountry(user.character, { countryId })) {
      return NextResponse.json(
        { error: "Only members of this party can request funds." },
        { status: 403 }
      );
    }

    // Pre-check treasury balance at propose time so members don't queue
    // a request the party clearly can't honor. Final balance check still
    // happens atomically at approve time.
    const treasury = party.treasury ?? 0;
    if (treasury < amount) {
      return NextResponse.json(
        { error: `Insufficient party treasury. Available: $${treasury.toLocaleString()}.` },
        { status: 400 }
      );
    }

    // With no seated Treasurer, double collapses to single so a single
    // officer (Chair/VC acting Treasurer) can approve the request.
    const mode = resolveTransactionApprovalMode(party);
    const eligibility = canRequestFunds(party, mode);
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.reason }, { status: 400 });
    }

    const { currentTurn } = await getGameTime();
    const row = await createPendingTransaction(
      db,
      {
        party,
        proposerCharacterId: user.character._id,
        type: "request",
        mode,
        amount,
        targetCharacterId: user.character._id, // recipient = requester
        note,
      },
      currentTurn
    );

    return NextResponse.json({
      success: true,
      pending: true,
      transactionId: row._id.toString(),
      message:
        mode === "single"
          ? `Requested $${amount.toLocaleString()}. Awaiting one officer approval.`
          : `Requested $${amount.toLocaleString()}. Awaiting Treasurer + Chair/VC approvals.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
