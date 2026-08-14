// POST /api/corporations/[id]/defence-contracts/[contractId] — accept or decline an offer
//
// Auth: the corporation's CEO (or admin). A government may award a contract, but the
// corporation decides whether to build it — this is the supplier's only lever over an order,
// and the counterpart to the minister's cancel.
//
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import { respondToContract } from "@/lib/db/collections/defenceContracts";

const bodySchema = z.object({ action: z.enum(["accept", "decline"]) });

interface RouteParams {
  params: Promise<{ id: string; contractId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id, contractId } = await params;
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // Contract ids are Mongo ObjectIds. The corporation param is not — corp pages
    // address /api/corporations/[id] by sequentialId (e.g. Lockheed is 453), and
    // `new ObjectId("453")` is the "Invalid id" the Accept button was hitting.
    if (!ObjectId.isValid(contractId) || contractId.length !== 24) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const contractObjectId = new ObjectId(contractId);

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const corp = resolved.corporation;

    const isCeo = corp.userId && corp.userId.toString() === auth.user.userId.toString();
    if (!isCeo && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only this corporation's CEO may answer a procurement offer." },
        { status: 403 }
      );
    }

    // Scoped to THIS corporation, not just the contract id: without it, any CEO could accept
    // or decline another corporation's offer by pasting its id.
    const contract = await db
      .collection<DefenceContract>("defenceContracts")
      .findOne({ _id: contractObjectId, corporationId: corp._id });
    if (!contract) {
      return NextResponse.json({ error: "No such contract" }, { status: 404 });
    }
    if (contract.status !== "pending") {
      return NextResponse.json(
        { error: "That offer has already been answered or withdrawn." },
        { status: 409 }
      );
    }

    const accept = parsed.data.action === "accept";
    // The write is guarded on `pending` too, so a double-click or an accept racing the
    // minister's cancel resolves to one winner rather than reviving a withdrawn order.
    const changed = await respondToContract(db, contractObjectId, accept);
    if (!changed) {
      return NextResponse.json(
        { error: "That offer has already been answered or withdrawn." },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, status: accept ? "active" : "declined" });
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "/api/corporations/[id]/defence-contracts/[contractId]",
    });
  }
}
