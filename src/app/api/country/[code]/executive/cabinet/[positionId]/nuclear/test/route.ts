// POST /api/country/[code]/executive/cabinet/[positionId]/nuclear/test
//
// Conduct a nuclear test: the only way a DEVICE node is adopted. A test is a
// world event - it spikes cold-war tension, shocks the country's deterrence
// board, and goes out on the wire - which is exactly why device adoption is
// not the quiet doctrine-style adopt the delivery legs get.
//
// Auth: defence cabinet holder or admin. Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";
import { applyTensionEvent } from "@/lib/coldwar/tension";
import { createSystemNewsPost } from "@/lib/news";
import { getNuclearProgram, putNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import {
  creditAppropriation,
  debitAppropriation,
  getDefenseAppropriation,
  uncommittedFrom,
} from "@/lib/db/collections/defenseAppropriation";
import { nuclearNode, nuclearNodeStatus } from "@/lib/military/nuclearProgram";
import { requireDefenceHolder, requireEligible, type NuclearRouteParams } from "../shared";

const testSchema = z.object({ nodeKey: z.string().min(1) });

export async function POST(request: Request, { params }: NuclearRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireDefenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const gate = await requireEligible(db, countryId);
    if ("error" in gate) return gate.error;

    const parsed = await parseJsonBody(request, testSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const node = nuclearNode(parsed.data.nodeKey);
    if (!node || node.kind !== "device") {
      return NextResponse.json({ error: "Not a device node" }, { status: 400 });
    }

    const program = await getNuclearProgram(db, countryId);
    const status = nuclearNodeStatus(node, program.adopted, gate.year ?? 0);
    if (status !== "available") {
      return NextResponse.json({ error: `Node is ${status}, not available` }, { status: 400 });
    }

    // Money first, through the guarded debit: the test costs the same defence
    // appropriation everything else spends, and two concurrent orders cannot
    // both clear against the same balance.
    const pot = await getDefenseAppropriation(db, countryId);
    if (uncommittedFrom(pot) < node.cost) {
      return NextResponse.json(
        { error: "Insufficient defence appropriation for the test" },
        { status: 409 }
      );
    }
    const paid = await debitAppropriation(db, countryId, node.cost);
    if (!paid) {
      return NextResponse.json(
        { error: "Insufficient defence appropriation for the test" },
        { status: 409 }
      );
    }

    const turn = gate.currentTurn;
    try {
      await putNuclearProgram(db, {
        ...program,
        adopted: { ...program.adopted, [node.key]: turn },
        lastTestTurn: turn,
      });
    } catch (error) {
      // Refund a test that never happened - money must not vanish on a failed write.
      await creditAppropriation(db, countryId, node.cost);
      throw error;
    }

    const countryName = COUNTRY_CONFIGS[countryId].name;
    const tension = await applyTensionEvent(
      db,
      turn,
      "nuclear-test",
      `${countryName} conducts a ${node.name} test`,
      node.tensionSpike ?? 0
    );
    // Country-wide VALUE shock on the deterrence family: an event the dynamics
    // phase relaxes, not a residual that would permanently redefine the nation.
    // Same helper and mode as crisis effects; never a dotted $inc.
    await applyBoardDelta(
      db,
      { countryId } as Filter<PoliticalMetricsDoc>,
      "order.deterrence",
      node.deterrenceShock ?? 0,
      "value"
    );
    await createSystemNewsPost(
      `${countryName} has conducted a ${node.name} test. ${node.desc}`,
      "executive",
      { title: `${countryName} Conducts Nuclear Test` }
    );

    return NextResponse.json({
      adopted: { ...program.adopted, [node.key]: turn },
      lastTestTurn: turn,
      tension: tension.value,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
