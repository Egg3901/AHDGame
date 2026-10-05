// POST /api/country/[code]/executive/cabinet/[positionId]/nuclear/adopt
//
// Adopt a DELIVERY node. Delivery legs adopt quietly, doctrine-style: same
// eligibility, availability and funding checks as a test, but no tension spike
// and no wire story - fielding a bomber wing is not a mushroom cloud. The
// deterrence board still moves, because a new leg is what makes the stockpile
// credible.
//
// Auth: defence cabinet holder or admin. Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";
import { getNuclearProgram, putNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import {
  creditAppropriation,
  debitAppropriation,
  getDefenseAppropriation,
  uncommittedFrom,
} from "@/lib/db/collections/defenseAppropriation";
import { nuclearNode, nuclearNodeStatus } from "@/lib/military/nuclearProgram";
import { requireDefenceHolder, requireEligible, type NuclearRouteParams } from "../shared";

const adoptSchema = z.object({ nodeKey: z.string().min(1) });

export async function POST(request: Request, { params }: NuclearRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const gate = await requireEligible(db, countryId);
    if ("error" in gate) return gate.error;

    const parsed = await parseJsonBody(request, adoptSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const node = nuclearNode(parsed.data.nodeKey);
    if (!node || node.kind !== "delivery") {
      return errorResponse(400, "Not a delivery node");
    }

    const program = await getNuclearProgram(db, countryId);
    const status = nuclearNodeStatus(node, program.adopted, gate.year ?? 0);
    if (status !== "available") {
      return errorResponse(400, `Node is ${status}, not available`);
    }

    const pot = await getDefenseAppropriation(db, countryId);
    if (uncommittedFrom(pot) < node.cost) {
      return errorResponse(409, "Insufficient defence appropriation");
    }
    const paid = await debitAppropriation(db, countryId, node.cost);
    if (!paid) {
      return errorResponse(409, "Insufficient defence appropriation");
    }

    const turn = gate.currentTurn;
    try {
      await putNuclearProgram(db, {
        ...program,
        adopted: { ...program.adopted, [node.key]: turn },
      });
    } catch (error) {
      await creditAppropriation(db, countryId, node.cost);
      throw error;
    }

    // Country-wide VALUE shock, same helper and mode as the test route.
    await applyBoardDelta(
      db,
      { countryId } as Filter<PoliticalMetricsDoc>,
      "order.deterrence",
      node.deterrenceShock ?? 0,
      "value"
    );

    return NextResponse.json({ adopted: { ...program.adopted, [node.key]: turn } });
  } catch (error) {
    return handleRouteError(error);
  }
}
