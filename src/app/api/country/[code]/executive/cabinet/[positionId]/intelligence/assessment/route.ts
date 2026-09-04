// GET .../intelligence/assessment?target=RU&domain=strategic|military
//
// What this service currently knows about one target, graded by live (decayed)
// coverage in the requested domain. `strategic` reads their nuclear posture;
// `military` reads their fronts, strength and readiness.
//
// SIGHT ONLY. Nothing here grants authority, and `conflictVisibility` is
// untouched: a non-belligerent with coverage gets an intelligence picture, never
// a belligerent's own command console.
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
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { belligerentSideOf } from "@/lib/military/conflictVisibility";
import { derivedSupplies } from "@/lib/military/occupation";
import { assessMilitary } from "@/lib/intelligence/militaryAssessment";
import { assessEconomic } from "@/lib/intelligence/economicAssessment";
import type { Corporation } from "@/lib/db/types/corporation";
import { COVERT_CAPABLE, COVERT_STAGES } from "@/lib/military/covertNuclear";
import { currentCoverage } from "@/lib/intelligence/coverage";
import {
  assessNuclear,
  assessmentTier,
  type NuclearFacts,
} from "@/lib/intelligence/strategicAssessment";
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

    const requestedDomain = new URL(request.url).searchParams.get("domain") ?? "strategic";
    if (
      requestedDomain !== "strategic" &&
      requestedDomain !== "military" &&
      requestedDomain !== "economic"
    ) {
      return NextResponse.json({ error: "Unknown assessment domain" }, { status: 400 });
    }

    const coverageRow = await (
      await getIntelligenceCoverageCollection(db)
    ).findOne({ ownerCountryId: countryId, targetCountryId, domain: requestedDomain });
    const coverage = coverageRow
      ? currentCoverage(coverageRow.valueAtCollection, turn - coverageRow.lastCollectedTurn)
      : 0;

    // Below the existence tier nothing is revealed, so do not read the target's
    // state at all. Cheaper, and it keeps facts the caller has not earned from
    // ever entering the request.
    if (assessmentTier(coverage) === "none") {
      return NextResponse.json({
        targetCountryId,
        domain: requestedDomain,
        coverage,
        turn,
        assessment:
          requestedDomain === "economic"
            ? assessEconomic(
                { corporationCount: 0, publicCount: 0, aggregateLiquidCapital: 0 },
                coverage,
                targetCountryId,
                turn
              )
            : requestedDomain === "military"
              ? assessMilitary(
                  { formationCount: 0, meanReadiness: 0, fronts: [] },
                  coverage,
                  targetCountryId,
                  turn
                )
              : assessNuclear(
                  { hasProgramme: false, warheads: 0, adoptedNodeCount: 0, covert: null },
                  coverage,
                  targetCountryId,
                  turn
                ),
      });
    }

    if (requestedDomain === "economic") {
      const corps = await db
        .collection<Corporation>("corporations")
        .find({ countryId: targetCountryId })
        .project({ isPrivate: 1, liquidCapital: 1 })
        .toArray();

      return NextResponse.json({
        targetCountryId,
        domain: requestedDomain,
        coverage,
        turn,
        assessment: assessEconomic(
          {
            corporationCount: corps.length,
            publicCount: corps.filter((c) => c.isPrivate !== true).length,
            aggregateLiquidCapital: corps.reduce((a, c) => a + (c.liquidCapital ?? 0), 0),
          },
          coverage,
          targetCountryId,
          turn
        ),
      });
    }

    if (requestedDomain === "military") {
      const units = await getMilitaryUnitsCollection(db)
        .find({ countryId: targetCountryId })
        .project({ readiness: 1 })
        .toArray();
      const meanReadiness =
        units.length === 0 ? 0 : units.reduce((a, u) => a + (u.readiness ?? 0), 0) / units.length;

      // Derived supply, the same way the game derives it. Serving the stored
      // base instead would report a figure no battle ever fights at.
      const conflicts = await listActiveConflicts(db);
      const fronts = conflicts
        .filter((c) => belligerentSideOf(c, targetCountryId) !== null)
        .map((c) => {
          const supplies = derivedSupplies(c);
          return {
            conflictId: String(c._id),
            supply:
              belligerentSideOf(c, targetCountryId) === "A" ? supplies.supplyA : supplies.supplyB,
          };
        });

      return NextResponse.json({
        targetCountryId,
        domain: requestedDomain,
        coverage,
        turn,
        assessment: assessMilitary(
          { formationCount: units.length, meanReadiness, fronts },
          coverage,
          targetCountryId,
          turn
        ),
      });
    }

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
      domain: requestedDomain,
      coverage,
      turn,
      assessment,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
