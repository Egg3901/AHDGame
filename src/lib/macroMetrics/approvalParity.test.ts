/**
 * SP5 §7 WAS the load-bearing parity golden: a non-playable country's approval
 * computed from the split stores' MERGED view had to equal the legacy
 * single-doc computation to the digit.
 *
 * Step 6 retired the premise. Non-playables no longer score approval from the
 * merged doc — they take it from the political board via `baseOverride`, and
 * the split no longer writes them a political half to merge. The equivalent
 * guarantee now lives in politicalApproval.test.ts, which pins that a freshly
 * seeded board country starts approval-neutral in every era.
 *
 * What survives, and is still worth pinning, is the MACRO half of the storage
 * split: every consumer of economic/population paths still reads them through
 * the merge, for playables and non-playables alike.
 */
import { describe, expect, it } from "vitest";
import type { StateMetrics } from "@/lib/db/types";
import {
  calculateStateApproval,
  computeApprovalBaseFromAverages,
  computeNationalAveragesFromMetrics,
  buildFlatMetrics,
} from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { mergeRegionMetrics } from "./merge";
import { splitMetricsDoc } from "./split";

function jpDoc(id: string, seed: number): StateMetrics {
  const v = (base: number) => ({ value: base + seed });
  return {
    _id: id,
    countryId: "JP",
    economic: {
      unemploymentRate: v(4),
      medianIncome: { value: 4_000_000 + seed * 100_000 },
      gdpGrowth: v(2),
      povertyRate: v(12),
      costOfLiving: v(100),
      smallBusinessFormation: v(8),
    },
    education: {
      testPerformance: v(70),
      educationSpending: v(50),
      literacyRate: v(97),
      workforceSkill: v(65),
    },
    healthcare: {
      physicianRate: v(45),
      lifeExpectancy: v(80),
      preventableMortality: v(20),
      publicHealthPreparedness: v(55),
    },
    infrastructure: {
      roadCondition: v(70),
      broadbandAccess: v(85),
      publicTransit: v(75),
      waterQuality: v(80),
      powerGridReliability: v(85),
      infrastructureInvestmentGap: v(25),
    },
    publicSafety: {
      crimeRate: { value: 1300 + seed * 50 },
      violentCrimeRate: v(30),
      policePerCapita: v(200),
      incarcerationRate: v(40),
      recidivismRate: v(45),
      publicSafetyConfidence: v(75),
    },
    environment: {
      airQuality: v(65),
      renewableEnergy: v(20),
      carbonEmissions: v(45),
      recyclingRate: v(20),
      climateResilience: v(60),
      protectedLand: v(15),
    },
    social: {
      socialMobility: v(55),
      incomeInequality: v(35),
      homelessnessRate: v(2),
      foodInsecurity: v(8),
      civicParticipation: v(50),
      socialCohesion: v(70),
    },
    governance: {
      governmentTransparency: v(60),
      budgetBalance: { value: -3 },
      corruptionIndex: v(25),
      voterTurnout: v(55),
      publicTrust: v(50),
    },
    population: {
      populationGrowth: { value: -0.2 + seed / 10 },
      urbanizationRate: v(90),
      medianAge: v(48),
      migrationRate: { value: 0.1 },
    },
    mediaInformation: {
      mediaPolarization: v(30),
      disinformationRisk: v(15),
      pressFreedom: v(65),
      socialMediaSentiment: v(50),
      newsTrust: v(55),
    },
    lastUpdated: new Date("2026-07-21T00:00:00.000Z"),
  } as StateMetrics;
}

describe("macro half survives the store split byte-identically", () => {
  const docs = [jpDoc("TOK", 0), jpDoc("KAN", 2), jpDoc("KYU", -3)];
  const mergedDocs = docs.map((d) => mergeRegionMetrics(splitMetricsDoc(d).macro)!);

  it("exposes economic and population exactly as the pre-split doc did", () => {
    for (let i = 0; i < docs.length; i++) {
      expect(mergedDocs[i].economic).toEqual(docs[i].economic);
      expect(mergedDocs[i].population).toEqual(docs[i].population);
    }
  });

  it("the national averages of the macro paths are unchanged", () => {
    const legacy = computeNationalAveragesFromMetrics(docs);
    const merged = computeNationalAveragesFromMetrics(mergedDocs);
    for (const category of ["economic", "population"] as const) {
      for (const [metricId, v] of Object.entries(merged[category] ?? {})) {
        expect(v, `${category}.${metricId}`).toBeCloseTo(
          (legacy[category] ?? {})[metricId] as number,
          9
        );
      }
    }
  });
});
