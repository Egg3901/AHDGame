// GET /api/country/[code]/executive/cabinet/[positionId]/intelligence/assessment?target=RU
//
// What this service currently knows about one target's nuclear posture, graded
// by live (decayed) `strategic` coverage.
//
// The raw facts and the fog factor NEVER leave the server. Serving the factor
// would make every estimate invertible, which is the mistake financialFogOfWar
// records having had to fix.
//
// Auth: the intelligence seat holder, their head of government or head of state,
// or an admin. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getCovertNuclearProgram } from "@/lib/db/collections/covertNuclearPrograms";
import { getNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import { getIntelligenceCoverageCollection } from "@/lib/db/collections/intelligence";
import { COVERT_CAPABLE, COVERT_STAGES } from "@/lib/military/covertNuclear";
import { currentCoverage } from "@/lib/intelligence/coverage";
import { assessNuclear, type NuclearFacts } from "@/lib/intelligence/strategicAssessment";
import {
  loadCurrentTurn,
  requireIntelligenceHolder,
  requireRegisteredTarget,
  type IntelligenceRouteParams,
} from "../shared";

export async function GET(request: Request, { params }: IntelligenceRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireIntelligenceHolder(code, positionId, { intent: "read" });
    if ("error" in guard) return guard.error;
    const { db, countryId } = guard;

    const requested = new URL(request.url).searchParams.get("target") ?? "";
    const target = await requireRegisteredTarget(db, requested, countryId);
    if ("error" in target) return target.error;
    const { targetCountryId } = target;

    const turn = await loadCurrentTurn(db);

    const coverageRow = await (
      await getIntelligenceCoverageCollection(db)
    ).findOne({ ownerCountryId: countryId, targetCountryId, domain: "strategic" });
    const coverage = coverageRow
      ? currentCoverage(coverageRow.valueAtCollection, turn - coverageRow.lastCollectedTurn)
      : 0;

    const overt = await getNuclearProgram(db, targetCountryId);
    // A country that cannot run a covert programme has no covert facts at all,
    // rather than dormant ones: `null` and "inactive" mean different things to
    // the assessment, and only the first is honest for, say, the United States.
    const covertCapable = COVERT_CAPABLE.includes(targetCountryId);
    const covertProgram = covertCapable ? await getCovertNuclearProgram(db, targetCountryId) : null;

    const facts: NuclearFacts = {
      hasProgramme: Object.keys(overt.adopted).length > 0 || overt.warheads > 0,
      warheads: overt.warheads,
      adoptedNodeCount: Object.keys(overt.adopted).length,
      covert: covertProgram
        ? {
            // A programme nobody has started is not something to find.
            active: covertProgram.stage > 0 || covertProgram.funding !== "none",
            stage: covertProgram.stage,
            stageCount: COVERT_STAGES.length,
          }
        : null,
    };

    const assessment = assessNuclear(facts, coverage, targetCountryId, turn);

    return NextResponse.json({
      targetCountryId,
      coverage,
      turn,
      assessment,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
