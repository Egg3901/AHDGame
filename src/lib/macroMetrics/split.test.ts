import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";
import type { StateMetrics } from "@/lib/db/types";
import { mergeRegionMetrics } from "./merge";
import { isMacroMetricPath, toMacroPath } from "./paths";
import { DROPPED_POLITICAL_CATEGORIES, splitMetricsDoc, writeSplitMetrics } from "./split";

const NOW = new Date("2026-07-21T00:00:00.000Z");

function fullDoc(id: string, countryId: string): StateMetrics {
  return {
    _id: id,
    countryId,
    economicModel: "market" as unknown as StateMetrics["economicModel"],
    economic: {
      unemploymentRate: { value: 4.2, trend: -0.1 },
      medianIncome: { value: 4100 },
      gdpGrowth: { value: 2.5 },
      povertyRate: { value: 12 },
      costOfLiving: { value: 100 },
      smallBusinessFormation: { value: 8 },
    },
    education: {
      testPerformance: { value: 60 },
      educationSpending: { value: 50 },
      literacyRate: { value: 97 },
      workforceSkill: { value: 62 },
    },
    healthcare: {
      physicianRate: { value: 40 },
      lifeExpectancy: { value: 68 },
      preventableMortality: { value: 30 },
      publicHealthPreparedness: { value: 45 },
    },
    infrastructure: {
      roadCondition: { value: 55 },
      broadbandAccess: { value: 0 },
      publicTransit: { value: 40 },
      waterQuality: { value: 70 },
      powerGridReliability: { value: 60 },
      infrastructureInvestmentGap: { value: 35 },
    },
    publicSafety: {
      crimeRate: { value: 3000 },
      violentCrimeRate: { value: 200 },
      policePerCapita: { value: 250 },
      incarcerationRate: { value: 150 },
      recidivismRate: { value: 40 },
      publicSafetyConfidence: { value: 55 },
    },
    environment: {
      airQuality: { value: 60 },
      renewableEnergy: { value: 5 },
      carbonEmissions: { value: 40 },
      recyclingRate: { value: 5 },
      climateResilience: { value: 50 },
      protectedLand: { value: 10 },
    },
    social: {
      socialMobility: { value: 50 },
      incomeInequality: { value: 40 },
      homelessnessRate: { value: 5 },
      foodInsecurity: { value: 12 },
      civicParticipation: { value: 55 },
      socialCohesion: { value: 60 },
    },
    governance: {
      governmentTransparency: { value: 45 },
      budgetBalance: { value: 0 },
      corruptionIndex: { value: 35 },
      voterTurnout: { value: 70 },
      publicTrust: { value: 55 },
      independenceDesire: { value: 58, trend: 0.1 },
    },
    population: {
      populationGrowth: { value: 1.2 },
      urbanizationRate: { value: 60 },
      medianAge: { value: 32 },
      migrationRate: { value: 0.2 },
    },
    mediaInformation: {
      mediaPolarization: { value: 25 },
      disinformationRisk: { value: 10 },
      pressFreedom: { value: 60 },
      socialMediaSentiment: { value: 0 },
      newsTrust: { value: 55 },
    },
    lastUpdated: NOW,
  } as StateMetrics;
}

describe("isMacroMetricPath / toMacroPath", () => {
  it("classifies macro, hoisted, and political paths", () => {
    expect(isMacroMetricPath("economic.gdpGrowth")).toBe(true);
    expect(isMacroMetricPath("economic.gdpGrowth.value")).toBe(true);
    expect(isMacroMetricPath("population.birthRate.value")).toBe(true);
    expect(isMacroMetricPath("independenceDesire")).toBe(true);
    expect(isMacroMetricPath("governance.independenceDesire.value")).toBe(true);
    expect(isMacroMetricPath("governance.publicTrust.value")).toBe(false);
    expect(isMacroMetricPath("publicSafety.crimeRate")).toBe(false);
  });

  it("hoists the legacy independence-desire path", () => {
    expect(toMacroPath("governance.independenceDesire.value")).toBe("independenceDesire.value");
    expect(toMacroPath("economic.gdpGrowth.value")).toBe("economic.gdpGrowth.value");
  });
});

describe("splitMetricsDoc (spec §5)", () => {
  it("playable doc → macro slice only, political null; independenceDesire hoisted", () => {
    const { macro } = splitMetricsDoc(fullDoc("SCO", "UK"));
    expect(macro.economic.gdpGrowth.value).toBe(2.5);
    expect(macro.population.medianAge.value).toBe(32);
    expect(macro.independenceDesire).toEqual({ value: 58, trend: 0.1 });
    expect(macro.economicModel).toBe("market");
    // governance on the macro doc carries ONLY the objective fiscal pair
    // (MACRO_GOVERNANCE_PATHS) — never the political governance metrics.
    expect(Object.keys(macro.governance ?? {}).sort()).toEqual(["budgetBalance"]);
    expect((macro.governance as Record<string, unknown>).publicTrust).toBeUndefined();
  });

  it("a BOARD country is macro-only too (step-6 Phase 3)", () => {
    // SP5 wrote a political remainder for non-playables because their consumers
    // still read it. Step 6 moved every reader to the board, routed their
    // legislation there, and baked their authored era values into it — so a
    // remainder would be written and never read.
    const { macro } = splitMetricsDoc(fullDoc("TOK", "JP"));
    expect(macro.economic.unemploymentRate.value).toBe(4.2);
    expect(macro.population.medianAge.value).toBe(32);
    expect((macro as unknown as Record<string, unknown>).publicSafety).toBeUndefined();
  });

  it("drops the political categories for EVERY country, board or not", () => {
    // There is no remainder branch any more. A country seeded without a board
    // would lose its political metrics entirely — which is the intended end
    // state: a new country must be given a board.
    const out = splitMetricsDoc(fullDoc("ZZ1", "ZZ" as never)) as unknown as Record<
      string,
      unknown
    >;
    expect(out.political).toBeUndefined();
    for (const category of DROPPED_POLITICAL_CATEGORIES) {
      if (category === "governance") continue; // keeps the hoisted macro fields
      expect((out.macro as Record<string, unknown>)[category], category).toBeUndefined();
    }
  });

  it("merge ∘ split round-trips the MACRO half", () => {
    const original = fullDoc("TOK", "JP");
    const { macro } = splitMetricsDoc(original);
    const merged = mergeRegionMetrics(macro)!;
    expect(merged.economic).toEqual(original.economic);
    expect(merged.population).toEqual(original.population);
  });

  it("merge tolerates a missing half", () => {
    const { macro } = splitMetricsDoc(fullDoc("TOK", "JP"));
    expect(mergeRegionMetrics(macro)!.economic.gdpGrowth.value).toBe(2.5);
    expect(mergeRegionMetrics(null)).toBeNull();
  });
});

describe("writeSplitMetrics", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("upserts ONLY macroMetrics for board countries, playable or not", async () => {
    db.collection("stateMetrics");
    await writeSplitMetrics(db as unknown as Db, fullDoc("TOK", "JP"));
    await writeSplitMetrics(db as unknown as Db, fullDoc("SCO", "UK"));

    const macroCalls = bulkOps(db.collectionMocks["macroMetrics"]!.bulkWrite);
    expect(macroCalls.map((c) => (c[0] as { _id: string })._id)).toEqual(["TOK", "SCO"]);
    // `upsert` moved INTO the bulk op, so it is read off the raw batch rather
    // than from a third updateOne argument. Still asserted — a macro doc that
    // does not yet exist must be created, not silently skipped.
    const batched = db.collectionMocks["macroMetrics"]!.bulkWrite.mock.calls.flatMap(
      (call) => (call[0] ?? []) as Array<{ updateOne?: { upsert?: boolean } }>
    );
    expect(batched).toHaveLength(2);
    for (const op of batched) expect(op.updateOne?.upsert).toBe(true);
    expect(db.collectionMocks["stateMetrics"]!.updateOne).not.toHaveBeenCalled();
  });
});
