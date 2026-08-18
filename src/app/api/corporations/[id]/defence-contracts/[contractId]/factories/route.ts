// PUT /api/corporations/[id]/defence-contracts/[contractId]/factories - set production lines
//
// Auth: the corporation's CEO (or admin). Suggestion #281: the CONTRACTOR decides how much of
// a plant works an order, so throughput is a lever the supplier holds rather than a fixed
// split the minister imposed. Price per lot is deliberately untouched - allocation buys speed,
// not a better deal.
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
import type { CorporateSector } from "@/lib/db/types/corporation";
import { componentsForStrategy } from "@/lib/military/arsenalComponents";
import {
  setContractFactories,
  assignedFactoriesForSector,
} from "@/lib/db/collections/defenceContracts";
import {
  defaultFactoryAllocation,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "@/lib/military/defenceLotEconomics";

const bodySchema = z.object({
  assignedFactories: z.number().int().min(1).max(DEFENCE_FACTORY_SLOTS_PER_PLANT),
});

interface RouteParams {
  params: Promise<{ id: string; contractId: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const { id, contractId } = await params;
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // Contract ids are ObjectIds; the corporation param is addressed by sequentialId.
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
        { error: "Only this corporation's CEO may assign production lines to a contract." },
        { status: 403 }
      );
    }

    // Scoped to THIS corporation, not just the contract id: without it any CEO could
    // re-allocate another company's plant by pasting an id.
    const contract = await db
      .collection<DefenceContract>("defenceContracts")
      .findOne({ _id: contractObjectId, corporationId: corp._id });
    if (!contract) {
      return NextResponse.json({ error: "No such contract" }, { status: 404 });
    }
    if (contract.status !== "pending" && contract.status !== "active") {
      return NextResponse.json(
        { error: "This order is closed, so its production lines cannot be changed." },
        { status: 409 }
      );
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: contract.sectorId });
    if (!sector) {
      return NextResponse.json(
        { error: "This contract's plant no longer exists." },
        { status: 409 }
      );
    }

    // The plant is the constraint, not the contract: total allocation across everything this
    // plant is building cannot exceed its lines. Without this a CEO could assign every order
    // the whole plant and be paid several times over for output built once.
    const fallback = defaultFactoryAllocation(
      componentsForStrategy(sector.strategyId).length,
      DEFENCE_FACTORY_SLOTS_PER_PLANT
    );
    const usedByOthers = await assignedFactoriesForSector(
      db,
      sector._id,
      fallback,
      contractObjectId
    );
    const free = Math.max(0, DEFENCE_FACTORY_SLOTS_PER_PLANT - usedByOthers);
    if (parsed.data.assignedFactories > free) {
      return NextResponse.json(
        {
          error:
            free > 0
              ? `This plant has ${free} of ${DEFENCE_FACTORY_SLOTS_PER_PLANT} production lines free. Free one from another order first.`
              : "Every production line at this plant is already committed to another order.",
          freeFactories: free,
          totalFactories: DEFENCE_FACTORY_SLOTS_PER_PLANT,
        },
        { status: 409 }
      );
    }

    const changed = await setContractFactories(db, contractObjectId, parsed.data.assignedFactories);
    if (!changed) {
      return NextResponse.json(
        { error: "This order closed before the change could be saved." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      assignedFactories: parsed.data.assignedFactories,
      freeFactories: free - parsed.data.assignedFactories,
      totalFactories: DEFENCE_FACTORY_SLOTS_PER_PLANT,
    });
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "/api/corporations/[id]/defence-contracts/[contractId]/factories",
    });
  }
}
