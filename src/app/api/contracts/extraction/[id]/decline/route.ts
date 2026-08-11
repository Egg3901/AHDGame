// POST /api/contracts/extraction/[id]/decline - Corp CEO declines an offered contract.
// Auth: requireBasicAuth + requireCeo of the contract's corporation.
// Errors: 400, 401, 403, 404, 409, 429

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { schemas } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCurrentTurn } from "@/lib/currentTurn";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { isContractIssuanceEnabled } from "@/lib/extraction/featureFlag";
import { getExtractionContractsCollection } from "@/lib/db/collections/extractionContracts";
import { declineContractOffer } from "@/lib/extraction/commands/declineContractOffer";
import { recordAudit } from "@/lib/audit/recordAudit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rate = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    if (!(await isContractIssuanceEnabled())) {
      return NextResponse.json({ error: "Extraction contracts are not enabled." }, { status: 403 });
    }

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success) throw badRequest("Invalid contract ID");

    const db = await getDb();
    const contractsCol = await getExtractionContractsCollection(db);
    const contract = await contractsCol.findOne({ _id: new ObjectId(id) });
    if (!contract) throw notFound("Contract not found");

    const resolved = await resolveCorporation(db, contract.corporationId.toString());
    if (!resolved.ok) return resolved.response;
    const ceoErr = requireCeo(resolved.corporation, auth.user.userId);
    if (ceoErr) return ceoErr;

    const turn = await getCurrentTurn(db);
    const result = await declineContractOffer(db, contract, turn, new Date());
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    recordAudit({
      source: "api",
      action: "contract.decline",
      category: "market",
      subject: {
        type: "extractionContract",
        id: contract._id,
        name: `${contract.resource}@${contract.stateId}`,
      },
      counterparty: {
        type: "corporation",
        id: resolved.corporation._id,
        name: resolved.corporation.name,
      },
      refs: { corporationId: resolved.corporation._id },
      delta: [{ field: "status", before: "offered", after: "declined" }],
      outcome: "ok",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
