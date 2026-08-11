// POST /api/contracts/extraction/offer - Issue an extraction-contract offer to a corporation.
// Auth: requireAuth (acting character); issuer level derived + gated by the authority law.
// Errors: 400, 401, 403, 404, 409, 429

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCurrentTurn } from "@/lib/currentTurn";
import { isContractIssuanceEnabled } from "@/lib/extraction/featureFlag";
import { issueContractOffer } from "@/lib/extraction/commands/issueContractOffer";
import { issueContractOfferSchema } from "@/lib/api/schemas/prospecting";
import { recordAudit } from "@/lib/audit/recordAudit";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rate = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    if (!(await isContractIssuanceEnabled())) {
      return NextResponse.json({ error: "Extraction contracts are not enabled." }, { status: 403 });
    }

    const parsed = await parseJsonBody(request, issueContractOfferSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const myChar = auth.user.character;
    if (!myChar) throw forbidden("Character required");

    const db = await getDb();
    const turn = await getCurrentTurn(db);
    const now = new Date();

    const result = await issueContractOffer(
      db,
      parsed.data,
      { characterId: myChar._id, isAdmin: auth.user.isAdmin === true },
      turn,
      now
    );
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.remainingHeadroom !== undefined
            ? { remainingHeadroom: result.remainingHeadroom }
            : {}),
        },
        { status: result.status }
      );
    }

    recordAudit({
      source: "api",
      action: "contract.offer",
      category: "market",
      subject: {
        type: "extractionContract",
        id: result.contractId,
        name: `${parsed.data.resource}@${parsed.data.stateId}`,
      },
      counterparty: { type: "corporation", id: parsed.data.corporationId },
      amount: parsed.data.signingFeeAnchor,
      refs: { corporationId: parsed.data.corporationId },
      delta: [
        { field: "status", before: null, after: "offered" },
        { field: "share", before: null, after: parsed.data.share },
        { field: "royaltyRatePerTurn", before: null, after: parsed.data.royaltyRatePerTurn },
        { field: "termTurns", before: null, after: parsed.data.termTurns },
      ],
      outcome: "ok",
    });

    return NextResponse.json({
      success: true,
      contractId: result.contractId,
      grantedByLevel: result.grantedByLevel,
      offerExpiresTurn: result.offerExpiresTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
