import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export async function GET() {
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        preset: 1,
        eurozoneEnabled: 1,
        eraSystemEnabled: 1,
        currentYear: 1,
        currentEraId: 1,
        startingYear: 1,
        incomeBandIndexByCountry: 1,
        liveElectionResultsEnabled: 1,
      },
    }
  );
  const eraOn = gs?.eraSystemEnabled ?? false;
  return NextResponse.json({
    preset: gs?.preset ?? DEFAULT_SEED_PRESET,
    eurozoneEnabled: gs?.eurozoneEnabled ?? true,
    eraSystemEnabled: eraOn,
    currentYear: gs?.currentYear ?? null,
    currentEraId: gs?.currentEraId ?? null,
    // Era income-band inputs (metric era catalog); null while the flag is off
    // so client scoring falls back to the full legacy band.
    startingYear: eraOn ? (gs?.startingYear ?? null) : null,
    incomeBandIndexByCountry: eraOn ? (gs?.incomeBandIndexByCountry ?? null) : null,
    liveElectionResultsEnabled: gs?.liveElectionResultsEnabled === true,
  });
}
