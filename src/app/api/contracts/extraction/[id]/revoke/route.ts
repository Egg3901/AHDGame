// POST /api/contracts/extraction/[id]/revoke - Issuer (or admin) revokes a contract.
// Auth: requireAuth (acting character); must be an issuer at the contract's granted level.
// Errors: 400, 401, 403, 404, 409, 429

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, notFound, forbidden } from "@/lib/api/errors";
import { schemas } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCurrentTurn } from "@/lib/currentTurn";
import { isContractIssuanceEnabled } from "@/lib/extraction/featureFlag";
import { getExtractionContractsCollection } from "@/lib/db/collections/extractionContracts";
import { revokeContract } from "@/lib/extraction/commands/revokeContract";
import { recordAudit } from "@/lib/audit/recordAudit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rate = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    if (!(await isContractIssuanceEnabled())) {
      return NextResponse.json({ error: "Extraction contracts are not enabled." }, { status: 403 });
    }

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success) throw badRequest("Invalid contract ID");

    const myChar = auth.user.character;
    if (!myChar) throw forbidden("Character required");

    const db = await getDb();
    const contractsCol = await getExtractionContractsCollection(db);
    const contract = await contractsCol.findOne({ _id: new ObjectId(id) });
    if (!contract) throw notFound("Contract not found");

    const turn = await getCurrentTurn(db);
    const result = await revokeContract(
      db,
      contract,
      { characterId: myChar._id, isAdmin: auth.user.isAdmin === true },
      turn,
      new Date()
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    recordAudit({
      source: "api",
      action: "contract.revoke",
      category: "market",
      subject: {
        type: "extractionContract",
        id: contract._id,
        name: `${contract.resource}@${contract.stateId}`,
      },
      counterparty: { type: "corporation", id: contract.corporationId },
      refs: { corporationId: contract.corporationId },
      delta: [{ field: "status", before: contract.status ?? "active", after: "revoked" }],
      outcome: "ok",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
