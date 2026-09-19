import { NextResponse } from "next/server";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { ALLOWED_FEATURE_FLAGS } from "@/lib/clientStatistics";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";

export const dynamic = "force-dynamic";

/** Local aggregates only. No names, identifiers or save documents leave this route. */
export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  const db = await getDb();
  const [state, partyCount, corporationCount, nppCount, employment, officeCounts, vital] =
    await Promise.all([
      db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            preset: 1,
            currentTurn: 1,
            singleplayerConfig: 1,
            singleplayerTurnMetrics: 1,
            nppAutonomyLevel: 1,
            ...Object.fromEntries(ALLOWED_FEATURE_FLAGS.map((key) => [key, 1])),
          },
        }
      ),
      db.collection("politicalParties").countDocuments(),
      db.collection("corporations").countDocuments(),
      db.collection("npps").countDocuments(),
      db
        .collection("corporateSectors")
        .aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: "$workers" } } }])
        .toArray(),
      db
        .collection("electedOfficials")
        .aggregate<{ total: number; npp: number }>([
          { $match: { $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true } }] } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              npp: { $sum: { $cond: [{ $eq: ["$isNPP", true] }, 1, 0] } },
            },
          },
        ])
        .toArray(),
      db.collection<EconomicVitalSigns>("economicVitalSigns").findOne(
        {},
        {
          sort: { turn: -1 },
          projection: { "goods.pooledFillRate.value": 1, "firms.lossMakingShare.value": 1 },
        }
      ),
    ]);
  if (!state) return NextResponse.json({ error: "No local world" }, { status: 409 });
  const stateValues = state as unknown as Record<string, unknown>;
  const storedFlags = state.singleplayerConfig?.featureFlags ?? {};
  const featureFlags = Object.fromEntries(
    ALLOWED_FEATURE_FLAGS.map((key) => {
      const stateValue = stateValues[key];
      return [key, typeof stateValue === "boolean" ? stateValue : storedFlags[key] === true];
    })
  );
  const metrics: Record<string, number> = {
    partyCount,
    corporationCount,
    nppCount,
    totalCorporationEmployment: Math.round(employment[0]?.total ?? 0),
  };
  if (state.singleplayerTurnMetrics) {
    metrics.lastTurnDurationMs = state.singleplayerTurnMetrics.durationMs;
    metrics.lastTurnWarningCount = state.singleplayerTurnMetrics.warningCount;
  }
  const offices = officeCounts[0];
  if (offices && offices.total > 0)
    metrics.nppOfficeSharePercent = (offices.npp / offices.total) * 100;
  for (const [key, value] of [
    ["marketFillRatePercent", vital?.goods?.pooledFillRate?.value],
    ["corporateLossMakingSharePercent", vital?.firms?.lossMakingShare?.value],
  ] as const) {
    if (typeof value === "number" && Number.isFinite(value)) metrics[key] = value * 100;
  }
  return NextResponse.json(
    {
      setup: {
        era: state.preset?.split("-")[0],
        mode: state.singleplayerConfig?.mode ?? "normal",
        difficulty: state.singleplayerConfig?.difficulty ?? "normal",
        autonomy: state.nppAutonomyLevel ?? "off",
        featureFlags,
      },
      metrics,
      turn: state.currentTurn,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
