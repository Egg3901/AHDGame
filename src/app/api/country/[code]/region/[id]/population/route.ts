import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State, StateMetrics, GameState } from "@/lib/db/types";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

const num = (x: { value?: number } | undefined): number | null =>
  typeof x?.value === "number" && Number.isFinite(x.value) ? x.value : null;

// GET /api/country/[code]/region/[id]/population — live cohort vector + derived
// population metrics + census/seat context for one region (P1d-3).
// Auth: public. Errors: 400, 404.
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;
    const db = await getDb();

    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const [demo, metrics, gameState] = await Promise.all([
      db.collection<RegionDemographics>("regionDemographics").findOne({ _id: stateId }),
      db.collection<StateMetrics>("macroMetrics").findOne({ _id: stateId }),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
    ]);

    const pop = metrics?.population as Record<string, { value?: number } | undefined> | undefined;

    // Per-region seat change from the last census, when this state moved.
    const lastCensus = (
      gameState as {
        lastCensus?: {
          year: number;
          deltas?: Array<{ state: string; from: number; to: number; delta: number }>;
        };
      } | null
    )?.lastCensus;
    const myDelta = lastCensus?.deltas?.find((d) => d.state === stateId);
    const censusSeatChange = myDelta
      ? { year: lastCensus!.year, from: myDelta.from, to: myDelta.to, delta: myDelta.delta }
      : null;

    return NextResponse.json(
      {
        stateId,
        stateName: state.name,
        population: state.population ?? null,
        houseDistricts: state.houseDistricts ?? null,
        ages: demo?.ages ?? null,
        populationMetrics: {
          populationGrowth: num(pop?.populationGrowth),
          medianAge: num(pop?.medianAge),
          sexRatio: num(pop?.sexRatio),
          dependencyRatio: num(pop?.dependencyRatio),
          realizedMigrationRate: num(pop?.realizedMigrationRate),
        },
        censusSeatChange,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
