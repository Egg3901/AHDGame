import { describe, expect, it } from "vitest";
import type { CampaignCapabilitySnapshot } from "@/lib/db/types/livingConflictCampaign";
import {
  advanceCampaignTurn,
  applyCampaignOutcome,
  assessCampaignRequirement,
  emptyCampaignState,
  estimateCampaignIntelligence,
  normalizeCampaignState,
  recordCampaignCommitment,
  shouldExposeCovertResponse,
} from "./campaign";

function capability(
  overrides: Partial<CampaignCapabilitySnapshot> = {}
): CampaignCapabilitySnapshot {
  return {
    treasuryPctGdp: 0.02,
    militaryReadiness: 70,
    logistics: 70,
    domesticSupport: 70,
    intelligence: 70,
    assessedAt: new Date("1960-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("living campaign model", () => {
  it("normalizes worlds created before campaign state existed", () => {
    expect(normalizeCampaignState(undefined)).toEqual(emptyCampaignState());
  });

  it("enforces stage and live national capacity requirements", () => {
    const result = assessCampaignRequirement(
      {
        allowedStages: ["operations"],
        minTreasuryPctGdp: 0.03,
        minMilitaryReadiness: 80,
        minLogistics: 75,
        minDomesticSupport: 65,
        minIntelligence: 60,
      },
      capability({
        treasuryPctGdp: 0.01,
        militaryReadiness: 50,
        logistics: 55,
        domesticSupport: 40,
        intelligence: 45,
      }),
      "posture"
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      "Available during Operations",
      "Needs 3.00% of GDP in treasury capacity",
      "Needs military readiness 80",
      "Needs logistics 75",
      "Needs domestic mandate 65",
      "Needs intelligence confidence 60",
    ]);
  });

  it("records national commitments once and carries their consequences forward", () => {
    const first = recordCampaignCommitment(emptyCampaignState(), "US", "response-1", 120, {
      kind: "military",
      side: "a",
      scale: 12,
      credibilityDelta: 4,
      warWearinessDelta: 3,
      consequences: { armsProliferation: 6, regionalSpillover: 2 },
    });
    const replay = recordCampaignCommitment(first, "US", "response-1", 120, {
      kind: "military",
      scale: 12,
      credibilityDelta: 4,
      consequences: { armsProliferation: 6 },
    });

    expect(first.countryMemory.US).toMatchObject({
      credibility: 54,
      warWeariness: 3,
      militaryCommitment: 12,
      lastResponseId: "response-1",
    });
    expect(first.consequences).toMatchObject({ armsProliferation: 6, regionalSpillover: 2 });
    expect(replay).toEqual(first);
  });

  it("applies aggregate outcomes once and advances the campaign stage", () => {
    const first = applyCampaignOutcome(emptyCampaignState(), {
      resolutionId: "resolution-1",
      outcomeId: "widening-war",
      delta: { casualties: 20, armsProliferation: 15 },
      nextStage: "operations",
    });
    const replay = applyCampaignOutcome(first.state, {
      resolutionId: "resolution-1",
      outcomeId: "widening-war",
      delta: { casualties: 20 },
      nextStage: "operations",
    });

    expect(first).toMatchObject({
      previousStage: "posture",
      nextStage: "operations",
      applied: true,
    });
    expect(first.state.cycle).toBe(2);
    expect(first.state.consequences.casualties).toBe(20);
    expect(replay.applied).toBe(false);
    expect(replay.state).toEqual(first.state);
  });

  it("gives countries stable but asymmetric intelligence pictures", () => {
    const campaign = applyCampaignOutcome(emptyCampaignState(), {
      resolutionId: "resolution-1",
      outcomeId: "mobilization",
      delta: { civilianStrain: 45, armsProliferation: 55, regionalSpillover: 35 },
      nextStage: "mobilization",
    }).state;
    const american = estimateCampaignIntelligence(campaign, capability(), {
      conflictKey: "vietnam",
      countryId: "US",
      role: "backer_a",
      turn: 180,
      intensity: 70,
    });
    const irish = estimateCampaignIntelligence(campaign, capability(), {
      conflictKey: "vietnam",
      countryId: "IE",
      role: "bystander",
      turn: 180,
      intensity: 70,
    });

    expect(american).toEqual(
      estimateCampaignIntelligence(campaign, capability(), {
        conflictKey: "vietnam",
        countryId: "US",
        role: "backer_a",
        turn: 180,
        intensity: 70,
      })
    );
    expect(american.confidence).toBe("high");
    expect(american.estimatedRiskMax - american.estimatedRiskMin).toBeLessThan(
      irish.estimatedRiskMax - irish.estimatedRiskMin
    );
    expect(american.estimatedRiskMin).not.toBe(irish.estimatedRiskMin);
  });

  it("keeps covert exposure rolls deterministic", () => {
    const first = shouldExposeCovertResponse("crisis-1", "RU", 45);
    expect(shouldExposeCovertResponse("crisis-1", "RU", 45)).toBe(first);
    expect(shouldExposeCovertResponse("crisis-1", "RU", 0)).toBe(false);
    expect(shouldExposeCovertResponse("crisis-1", "RU", 100)).toBe(true);
  });

  it("lets aftermath pressure decay while permanent damage heals slowly", () => {
    const aftermath = applyCampaignOutcome(emptyCampaignState(), {
      resolutionId: "resolution-1",
      outcomeId: "settled",
      delta: {
        civilianStrain: 20,
        refugees: 20,
        infrastructureDamage: 20,
        regionalSpillover: 20,
        settlementMomentum: 80,
      },
      nextStage: "aftermath",
    }).state;
    const next = advanceCampaignTurn(aftermath);

    expect(next.stage).toBe("aftermath");
    expect(next.consequences.civilianStrain).toBe(19.5);
    expect(next.consequences.infrastructureDamage).toBe(19.9);
    expect(next.consequences.settlementMomentum).toBe(79.8);
  });
});
