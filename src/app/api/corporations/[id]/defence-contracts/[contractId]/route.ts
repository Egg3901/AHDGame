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
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import { respondToContract } from "@/lib/db/collections/defenceContracts";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { resolveFillEligibility, FILL_REASON_TEXT } from "@/lib/military/defenceFillEligibility";
import { getGameState } from "@/lib/gameState";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { isProcurementBlocked } from "@/lib/military/procurementGate";

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
      return errorResponse(parsed.status, parsed.error);
    }

    // Contract ids are Mongo ObjectIds. The corporation param is not — corp pages
    // address /api/corporations/[id] by sequentialId (e.g. Lockheed is 453), and
    // `new ObjectId("453")` is the "Invalid id" the Accept button was hitting.
    if (!ObjectId.isValid(contractId) || contractId.length !== 24) {
      return errorResponse(400, "Invalid id");
    }
    const contractObjectId = new ObjectId(contractId);

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const corp = resolved.corporation;

    const isCeo = corp.userId && corp.userId.toString() === auth.user.userId.toString();
    if (!isCeo && !auth.user.isAdmin) {
      return errorResponse(403, "Only this corporation's CEO may answer a procurement offer.");
    }

    // Scoped to THIS corporation, not just the contract id: without it, any CEO could accept
    // or decline another corporation's offer by pasting its id.
    const contract = await db
      .collection<DefenceContract>("defenceContracts")
      .findOne({ _id: contractObjectId, corporationId: corp._id });
    if (!contract) {
      return errorResponse(404, "No such contract");
    }
    if (contract.status !== "pending") {
      return errorResponse(409, "That offer has already been answered or withdrawn.");
    }

    const accept = parsed.data.action === "accept";
    // The same fill question the minister's award and the delivery sweep ask. A CEO who
    // re-tooled the plant between the offer and this click must not be able to accept an order
    // the sweep will refuse forever: accepting it would hold the country's appropriation
    // encumbered against materiel that can never arrive.
    if (accept) {
      const sector = await db
        .collection<CorporateSector>("corporateSectors")
        .findOne({ _id: contract.sectorId });
      if (!sector) {
        return errorResponse(409, "This contract's plant no longer exists.");
      }
      const gameState = await getGameState();
      const currentTurn = gameState?.currentTurn ?? 1;
      const fill = resolveFillEligibility({
        corp,
        sector,
        countryId: contract.countryId,
        currentYear: STARTING_YEAR + Math.floor((currentTurn - 1) / TURNS_PER_YEAR),
        component: contract.component,
        assignedFactories: contract.assignedFactories,
      });
      if (!fill.eligible) {
        return errorResponse(409, FILL_REASON_TEXT[fill.reason ?? "no_materiel_line"]);
      }
    }
    // Accepting turns a pending offer into a live, billing order - a NEW obligation, so it is
    // frozen with awards. Declining only closes an offer and stays open, so a CEO can still
    // clear their board while procurement is paused.
    if (accept) {
      // Barred by the world kill switch, or by a peace settlement that named the
      // BUYING country. The buyer is the contract's country, not the corporation's
      // owner: a settlement bars a government from ordering, not a firm from
      // trading.
      const gateState = await getGameState();
      const gate = await isProcurementBlocked(db, contract.countryId, gateState?.currentTurn ?? 0);
      if (gate.blocked) {
        return errorResponse(409, gate.reason);
      }
    }
    // The write is guarded on `pending` too, so a double-click or an accept racing the
    // minister's cancel resolves to one winner rather than reviving a withdrawn order.
    const changed = await respondToContract(db, contractObjectId, accept);
    if (!changed) {
      return errorResponse(409, "That offer has already been answered or withdrawn.");
    }

    return NextResponse.json({ success: true, status: accept ? "active" : "declined" });
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "/api/corporations/[id]/defence-contracts/[contractId]",
    });
  }
}
