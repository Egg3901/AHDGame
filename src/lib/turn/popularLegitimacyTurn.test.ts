import { describe, it, expect } from "vitest";
import { computePopularTurnDrift, type PopularTurnInputs } from "@/lib/turn/popularLegitimacyTurn";
import { CN_POPULAR_MOOD_PROFILE } from "@/lib/constants/popularMoodProfiles";

const neutralInputs: PopularTurnInputs = {
  currentLegitimacy: 75,
  partyConfidence: 70,
  economic: {
    gdpGrowthAnnualPct: 2.5,
    unemploymentDeltaPct: 0,
    inflationDeviationFromTargetPct: 0,
  },
  purges: [],
  enactedBills: [],
  election: { isElectionTurn: false, opsMultiplier: 1.0 },
  internalRepression: { internalRepression: 0, shortageIndex: 0 },
  moodProfile: CN_POPULAR_MOOD_PROFILE,
  boosts: [],
  currentTurn: 100,
};

describe("computePopularTurnDrift", () => {
  it("a quiet turn at 75 (above target) drifts toward target via natural recovery", () => {
    const drift = computePopularTurnDrift(neutralInputs);
    // 75 is above target (60), so natural recovery drift is -0.1.
    // Other components all 0 at neutral inputs.
    expect(drift.total).toBeCloseTo(-0.1, 2);
  });

  it("a quiet turn at 40 (below target) drifts up via natural recovery", () => {
    const drift = computePopularTurnDrift({ ...neutralInputs, currentLegitimacy: 40 });
    expect(drift.total).toBeCloseTo(0.1, 2);
  });

  it("a disaster turn yields drift in [-6, -3]", () => {
    const drift = computePopularTurnDrift({
      currentLegitimacy: 50,
      partyConfidence: 10,
      economic: {
        gdpGrowthAnnualPct: -10,
        unemploymentDeltaPct: 5,
        inflationDeviationFromTargetPct: 8,
      },
      purges: [
        { severity: "extreme", kind: "discipline" },
        { severity: "major", kind: "ideological" },
      ],
      enactedBills: [{ axisEffects: { economicProsperity: -1.0, civilLiberties: -1.0 } }],
      election: { isElectionTurn: true, opsMultiplier: 1.5 },
      internalRepression: { internalRepression: 0, shortageIndex: 0 },
      moodProfile: CN_POPULAR_MOOD_PROFILE,
      boosts: [],
      currentTurn: 100,
    });
    expect(drift.total).toBeLessThanOrEqual(-3.0);
    expect(drift.total).toBeGreaterThanOrEqual(-6.0);
  });

  it("returns per-component breakdown", () => {
    const drift = computePopularTurnDrift(neutralInputs);
    expect(drift).toHaveProperty("components.economic");
    expect(drift).toHaveProperty("components.repression");
    expect(drift).toHaveProperty("components.policy");
    expect(drift).toHaveProperty("components.election");
    expect(drift).toHaveProperty("components.coupling");
    expect(drift).toHaveProperty("components.naturalRecovery");
    expect(drift).toHaveProperty("total");
  });

  it("a typical mild-bad turn is within ±2", () => {
    const drift = computePopularTurnDrift({
      ...neutralInputs,
      currentLegitimacy: 55,
      economic: {
        gdpGrowthAnnualPct: 1.0,
        unemploymentDeltaPct: 0.5,
        inflationDeviationFromTargetPct: 1.0,
      },
      purges: [{ severity: "minor", kind: "discipline" }],
    });
    expect(Math.abs(drift.total)).toBeLessThanOrEqual(2.0);
  });

  it("total equals sum of components", () => {
    const drift = computePopularTurnDrift({
      ...neutralInputs,
      currentLegitimacy: 45,
      economic: {
        gdpGrowthAnnualPct: 1.5,
        unemploymentDeltaPct: 0.2,
        inflationDeviationFromTargetPct: 0,
      },
      purges: [{ severity: "minor", kind: "discipline" }],
    });
    const sum =
      drift.components.economic +
      drift.components.repression +
      drift.components.internalRepression +
      drift.components.policy +
      drift.components.election +
      drift.components.coupling +
      drift.components.naturalRecovery +
      drift.components.boosts;
    expect(drift.total).toBeCloseTo(sum, 10);
  });

  it("anticorruption purge does not contribute to repression", () => {
    const withAnticorrupt = computePopularTurnDrift({
      ...neutralInputs,
      purges: [{ severity: "major", kind: "anticorruption" }],
    });
    expect(withAnticorrupt.components.repression).toBe(0);
  });

  it("active boost modifiers add positively to the drift", () => {
    const drift = computePopularTurnDrift({
      ...neutralInputs,
      currentTurn: 100,
      boosts: [
        { source: "legalizeParty", perTurnDelta: 0.2, untilTurn: 200 },
        { source: "reduceVoteMultipliers", perTurnDelta: 0.15, untilTurn: 150 },
      ],
    });
    expect(drift.components.boosts).toBeCloseTo(0.35, 4);
  });

  it("expired boost modifiers are excluded from the sum", () => {
    const drift = computePopularTurnDrift({
      ...neutralInputs,
      currentTurn: 250,
      boosts: [
        { source: "legalizeParty", perTurnDelta: 0.2, untilTurn: 200 }, // expired
        { source: "constitutionalAmendment", perTurnDelta: 0.3, untilTurn: 400 }, // active
      ],
    });
    expect(drift.components.boosts).toBeCloseTo(0.3, 4);
  });

  it("internal repression amid shortage drags total legitimacy drift down", () => {
    const noRepression = computePopularTurnDrift({
      ...neutralInputs,
      internalRepression: { internalRepression: 0, shortageIndex: 70 },
    });
    const heavyRepression = computePopularTurnDrift({
      ...neutralInputs,
      internalRepression: { internalRepression: 0.9, shortageIndex: 70 },
    });
    expect(heavyRepression.components.internalRepression).toBeLessThan(0);
    expect(noRepression.components.internalRepression).toBe(0);
    expect(heavyRepression.total).toBeLessThan(noRepression.total);
  });

  it("popular collapse couples into intra-party bleed correctly", () => {
    const stable = computePopularTurnDrift({
      ...neutralInputs,
      currentLegitimacy: 50,
      partyConfidence: 50,
    });
    const collapsing = computePopularTurnDrift({
      ...neutralInputs,
      currentLegitimacy: 50,
      partyConfidence: 10,
    });
    // The "coupling" component is the *party→popular* leak inside this
    // module; collapsing intra-party should yield a more-negative
    // coupling contribution.
    expect(collapsing.components.coupling).toBeLessThan(stable.components.coupling);
  });
});
