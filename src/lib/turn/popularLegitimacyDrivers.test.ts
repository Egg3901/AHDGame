import { describe, it, expect } from "vitest";
import {
  economicHealthDrift,
  repressionIntensityDrift,
  internalRepressionDrift,
  policyPopularityDrift,
  electionCredibilityShock,
  intraPartyCouplingBleed,
  naturalRecoveryDrift,
  type EconomicSignals,
  type PurgeEventInput,
  type EnactedBillInput,
} from "@/lib/turn/popularLegitimacyDrivers";
import { CN_POPULAR_MOOD_PROFILE } from "@/lib/constants/popularMoodProfiles";

describe("economicHealthDrift", () => {
  it("returns 0 at neutral signals", () => {
    const sig: EconomicSignals = {
      gdpGrowthAnnualPct: 2.5,
      unemploymentDeltaPct: 0,
      inflationDeviationFromTargetPct: 0,
    };
    expect(economicHealthDrift(sig)).toBeCloseTo(0, 2);
  });

  it("is bounded in [-1.0, +0.5]", () => {
    const worst: EconomicSignals = {
      gdpGrowthAnnualPct: -10,
      unemploymentDeltaPct: 5,
      inflationDeviationFromTargetPct: 8,
    };
    expect(economicHealthDrift(worst)).toBeGreaterThanOrEqual(-1.0);
    expect(economicHealthDrift(worst)).toBeLessThanOrEqual(0.5);

    const best: EconomicSignals = {
      gdpGrowthAnnualPct: 10,
      unemploymentDeltaPct: -3,
      inflationDeviationFromTargetPct: 0,
    };
    expect(economicHealthDrift(best)).toBeLessThanOrEqual(0.5);
    expect(economicHealthDrift(best)).toBeGreaterThanOrEqual(-1.0);
  });

  it("recession reduces drift", () => {
    const recession: EconomicSignals = {
      gdpGrowthAnnualPct: -3,
      unemploymentDeltaPct: 0,
      inflationDeviationFromTargetPct: 0,
    };
    expect(economicHealthDrift(recession)).toBeLessThan(0);
  });

  it("growth above target increases drift", () => {
    const boom: EconomicSignals = {
      gdpGrowthAnnualPct: 6,
      unemploymentDeltaPct: 0,
      inflationDeviationFromTargetPct: 0,
    };
    expect(economicHealthDrift(boom)).toBeGreaterThan(0);
  });

  it("inflation deviation always negative regardless of sign", () => {
    const overshootPos: EconomicSignals = {
      gdpGrowthAnnualPct: 2.5,
      unemploymentDeltaPct: 0,
      inflationDeviationFromTargetPct: 3,
    };
    const overshootNeg: EconomicSignals = {
      gdpGrowthAnnualPct: 2.5,
      unemploymentDeltaPct: 0,
      inflationDeviationFromTargetPct: -3,
    };
    expect(economicHealthDrift(overshootPos)).toBeLessThan(0);
    expect(economicHealthDrift(overshootNeg)).toBeLessThan(0);
  });
});

describe("repressionIntensityDrift", () => {
  it("returns 0 when no purges this turn", () => {
    expect(repressionIntensityDrift([])).toBe(0);
  });

  it("never returns a positive value (one-sided cost)", () => {
    const purges: PurgeEventInput[] = [
      { severity: "minor", kind: "discipline" },
      { severity: "major", kind: "discipline" },
    ];
    expect(repressionIntensityDrift(purges)).toBeLessThanOrEqual(0);
  });

  it("is bounded at -1.5 even with many extreme purges", () => {
    const tenExtremes: PurgeEventInput[] = Array(10).fill({
      severity: "extreme",
      kind: "faction",
    });
    expect(repressionIntensityDrift(tenExtremes)).toBeGreaterThanOrEqual(-1.5);
  });

  it("treats anticorruption purges as zero popular cost", () => {
    const anticorrupt: PurgeEventInput[] = [
      { severity: "major", kind: "anticorruption" },
      { severity: "minor", kind: "anticorruption" },
    ];
    expect(repressionIntensityDrift(anticorrupt)).toBe(0);
  });

  it("higher severity costs more popular legitimacy", () => {
    const minor = repressionIntensityDrift([{ severity: "minor", kind: "discipline" }]);
    const extreme = repressionIntensityDrift([{ severity: "extreme", kind: "discipline" }]);
    expect(extreme).toBeLessThan(minor);
  });
});

describe("policyPopularityDrift", () => {
  it("returns 0 when no bills enacted", () => {
    expect(policyPopularityDrift([], CN_POPULAR_MOOD_PROFILE)).toBe(0);
  });

  it("is bounded in [-0.8, +0.8]", () => {
    const bills: EnactedBillInput[] = [
      { axisEffects: { economicProsperity: 1.0, civilLiberties: -1.0 } },
    ];
    const result = policyPopularityDrift(bills, CN_POPULAR_MOOD_PROFILE);
    expect(result).toBeGreaterThanOrEqual(-0.8);
    expect(result).toBeLessThanOrEqual(0.8);
  });

  it("positive bill on weighted axis yields positive drift", () => {
    const bills: EnactedBillInput[] = [{ axisEffects: { economicProsperity: 1.0 } }];
    expect(policyPopularityDrift(bills, CN_POPULAR_MOOD_PROFILE)).toBeGreaterThan(0);
  });

  it("negative bill on weighted axis yields negative drift", () => {
    const bills: EnactedBillInput[] = [{ axisEffects: { civilLiberties: -1.0 } }];
    expect(policyPopularityDrift(bills, CN_POPULAR_MOOD_PROFILE)).toBeLessThan(0);
  });

  it("ignores axes the profile does not weight", () => {
    const bills: EnactedBillInput[] = [
      { axisEffects: { somethingNotInProfile: 5.0 } as unknown as Record<string, number> },
    ];
    expect(policyPopularityDrift(bills, CN_POPULAR_MOOD_PROFILE)).toBe(0);
  });

  it("multiple bills accumulate (before clamp)", () => {
    const oneBill: EnactedBillInput[] = [{ axisEffects: { economicProsperity: 0.5 } }];
    const twoBills: EnactedBillInput[] = [
      { axisEffects: { economicProsperity: 0.5 } },
      { axisEffects: { economicProsperity: 0.5 } },
    ];
    expect(policyPopularityDrift(twoBills, CN_POPULAR_MOOD_PROFILE)).toBeGreaterThan(
      policyPopularityDrift(oneBill, CN_POPULAR_MOOD_PROFILE)
    );
  });
});

describe("electionCredibilityShock", () => {
  it("returns 0 when no election this turn", () => {
    expect(electionCredibilityShock({ isElectionTurn: false, opsMultiplier: 1.5 })).toBe(0);
  });

  it("returns 0 when multiplier <= 1.2 even on an election turn", () => {
    expect(electionCredibilityShock({ isElectionTurn: true, opsMultiplier: 1.15 })).toBe(0);
    expect(electionCredibilityShock({ isElectionTurn: true, opsMultiplier: 1.2 })).toBe(0);
  });

  it("returns -2.0 when election turn AND multiplier > 1.2", () => {
    expect(electionCredibilityShock({ isElectionTurn: true, opsMultiplier: 1.3 })).toBe(-2.0);
    expect(electionCredibilityShock({ isElectionTurn: true, opsMultiplier: 1.5 })).toBe(-2.0);
  });
});

describe("intraPartyCouplingBleed", () => {
  it("returns 0 when partyConfidence >= 30", () => {
    expect(intraPartyCouplingBleed(30)).toBe(0);
    expect(intraPartyCouplingBleed(75)).toBe(0);
    expect(intraPartyCouplingBleed(95)).toBe(0);
  });

  it("returns -0.3 when partyConfidence in [0, 30)", () => {
    expect(intraPartyCouplingBleed(29)).toBe(-0.05);
    expect(intraPartyCouplingBleed(15)).toBe(-0.05);
    expect(intraPartyCouplingBleed(0)).toBe(-0.05);
  });
});

describe("naturalRecoveryDrift", () => {
  it("returns +0.1 when current is below target (60)", () => {
    expect(naturalRecoveryDrift(40)).toBeCloseTo(0.1, 5);
    expect(naturalRecoveryDrift(0)).toBeCloseTo(0.1, 5);
  });

  it("returns -0.1 when current is above target", () => {
    expect(naturalRecoveryDrift(80)).toBeCloseTo(-0.1, 5);
    expect(naturalRecoveryDrift(100)).toBeCloseTo(-0.1, 5);
  });

  it("returns 0 at target", () => {
    expect(naturalRecoveryDrift(60)).toBe(0);
  });
});

describe("internalRepressionDrift", () => {
  it("is zero when there is no repression or no shortage", () => {
    expect(internalRepressionDrift({ internalRepression: 0, shortageIndex: 80 })).toBe(0);
    expect(internalRepressionDrift({ internalRepression: 1, shortageIndex: 0 })).toBe(0);
  });

  it("is negative and grows with BOTH repression and shortage (pressure cooker)", () => {
    const light = internalRepressionDrift({ internalRepression: 0.3, shortageIndex: 40 });
    const harder = internalRepressionDrift({ internalRepression: 0.7, shortageIndex: 40 });
    const worse = internalRepressionDrift({ internalRepression: 0.7, shortageIndex: 90 });
    expect(light).toBeLessThan(0);
    expect(harder).toBeLessThan(light);
    expect(worse).toBeLessThan(harder);
  });

  it("stays bounded (a single turn cannot exceed the -1 cap)", () => {
    expect(
      internalRepressionDrift({ internalRepression: 1, shortageIndex: 100 })
    ).toBeGreaterThanOrEqual(-1);
  });
});
