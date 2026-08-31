// GET /api/country/[code]/executive/cabinet/[positionId]/intelligence
//
// The service as its own director sees it: agency, networks, live coverage,
// slots left this turn, and the recent incident log.
//
// Auth: the intelligence seat holder, their head of government or head of state,
// or an admin (the office-visibility rule). Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import {
  getIntelligenceCoverageCollection,
  getIntelligenceNetworksCollection,
  getIntelligenceOpLogCollection,
} from "@/lib/db/collections/intelligence";
import { currentCoverage } from "@/lib/intelligence/coverage";
import { slotsRemaining } from "@/lib/intelligence/slots";
import {
  getOrCreateAgency,
  loadCurrentTurn,
  requireIntelligenceHolder,
  type IntelligenceRouteParams,
} from "./shared";

const INCIDENT_LIMIT = 25;

export async function GET(_request: Request, { params }: IntelligenceRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireIntelligenceHolder(code, positionId, { intent: "read" });
    if ("error" in guard) return guard.error;
    const { db, countryId, member } = guard;

    const turn = await loadCurrentTurn(db);
    const agency = await getOrCreateAgency(db, countryId, turn, member?.characterId ?? null);

    const [networks, coverage, incidents] = await Promise.all([
      (await getIntelligenceNetworksCollection(db)).find({ ownerCountryId: countryId }).toArray(),
      (await getIntelligenceCoverageCollection(db)).find({ ownerCountryId: countryId }).toArray(),
      (await getIntelligenceOpLogCollection(db))
        .find({ ownerCountryId: countryId })
        .sort({ turn: -1 })
        .limit(INCIDENT_LIMIT)
        .toArray(),
    ]);

    return NextResponse.json({
      agency: {
        tradecraft: agency.tradecraft,
        counterIntel: agency.counterIntel,
        budgetRemaining: agency.budgetRemaining,
        foundedTurn: agency.foundedTurn,
        hasDirector: agency.directorCharacterId != null,
      },
      turn,
      slotsRemaining: slotsRemaining(agency, turn),
      networks: networks.map((n) => ({
        targetCountryId: n.targetCountryId,
        level: n.level,
        progress: n.progress,
        funding: n.funding,
        suspicion: n.suspicion,
        status: n.status,
        cooledUntilTurn: n.cooledUntilTurn,
      })),
      // The DERIVED reading, never the stored one: coverage decays with age and
      // the console must show what an operation would actually be judged on.
      coverage: coverage.map((c) => ({
        targetCountryId: c.targetCountryId,
        domain: c.domain,
        value: currentCoverage(c.valueAtCollection, turn - c.lastCollectedTurn),
        lastCollectedTurn: c.lastCollectedTurn,
      })),
      // `rollDetail` is deliberately absent: it is audit and simulation material,
      // and serving it would publish the exact odds behind every operation.
      incidents: incidents.map((i) => ({
        targetCountryId: i.targetCountryId,
        domain: i.domain,
        opType: i.opType,
        outcome: i.outcome,
        compromise: i.compromise,
        effectSummary: i.effectSummary,
        turn: i.turn,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
