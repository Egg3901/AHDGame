// GET /api/country/[code]/executive/cabinet/[positionId]/nuclear
//
// The nuclear programme's status surface: the programme document, every tree
// node's status for the current game year, the adopted tier's production
// numbers, the deterrence reading, and the three entry gates. Deliberately
// readable while INELIGIBLE - the console needs to show a locked programme and
// say why, so ineligibility is data here and a refusal only on the mutations.
//
// Auth: defence cabinet holder or admin. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import {
  NUCLEAR_NODES,
  deterrenceScore,
  nuclearNodeStatus,
  productionCapFor,
  warheadUnitCost,
} from "@/lib/military/nuclearProgram";
import { resolveGameYear } from "@/lib/era/era";
import {
  loadGameStateSlice,
  requireDefenceHolder,
  resolveEligibility,
  type NuclearRouteParams,
} from "./shared";

export async function GET(request: Request, { params }: NuclearRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId, { intent: "read" });
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const gs = await loadGameStateSlice(db);
    const year = resolveGameYear(gs ?? {});
    const [program, eligibility] = await Promise.all([
      getNuclearProgram(db, countryId),
      resolveEligibility(db, countryId, gs?.coldWarEnabled === true),
    ]);

    return NextResponse.json({
      program: {
        adopted: program.adopted,
        warheads: program.warheads,
        productionRate: program.productionRate,
        lastTestTurn: program.lastTestTurn ?? null,
      },
      // A world with no resolvable year exposes every node as "future" rather
      // than guessing an era - the same fail-closed direction the turn takes.
      nodes: NUCLEAR_NODES.map((node) => ({
        ...node,
        status: nuclearNodeStatus(node, program.adopted, year ?? 0),
      })),
      productionCap: productionCapFor(program.adopted),
      warheadUnitCost: warheadUnitCost(program.adopted),
      deterrence: deterrenceScore(program.adopted, program.warheads),
      eligibility,
      year,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
