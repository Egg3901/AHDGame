import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
  scheduledPressureDeltas,
} from "./engine";
import { PANDEMIC_DEF } from "./defs/pandemic";

function stateAt(phaseKey: string, tracks: Record<string, number> = {}) {
  const phase = PANDEMIC_DEF.phases.find((candidate) => candidate.key === phaseKey);
  if (!phase) throw new Error(`Unknown pandemic phase: ${phaseKey}`);
  return normalizeConflictState(PANDEMIC_DEF, {
    defKey: PANDEMIC_DEF.key,
    hasOpened: true,
    openedYear: 2019,
    phaseLevel: phase.level,
    tracks,
  });
}

function outcome(id: string) {
  for (const phase of PANDEMIC_DEF.phases) {
    for (const event of phase.events) {
      const found = event.response?.outcomes.find((candidate) => candidate.outcomeId === id);
      if (found) return found;
    }
  }
  throw new Error(`Unknown pandemic outcome: ${id}`);
}

describe("pandemic living conflict", () => {
  it("preserves the stored definition key and phase levels", () => {
    const legacy = normalizeConflictState(PANDEMIC_DEF, {
      defKey: "pandemic",
      hasOpened: true,
      phaseLevel: 3,
      openedYear: 2020,
    });

    expect(PANDEMIC_DEF.key).toBe("pandemic");
    expect(PANDEMIC_DEF.phases.map((phase) => [phase.key, phase.level])).toEqual([
      ["emergence", 1],
      ["outbreak", 2],
      ["pandemic", 3],
      ["containment", 4],
      ["endemic", 5],
    ]);
    expect(legacy.tracks).toMatchObject({ transmission: 28, healthCapacity: 68, immunity: 0 });
    expect(PANDEMIC_DEF.participantFallbacks).toMatchObject({
      CN: ["IN", "JP"],
      US: ["UK", "DE", "FR"],
    });
  });

  it("allows surveillance and containment to stop the first cluster", () => {
    const coordinated = applyConflictOutcome(
      PANDEMIC_DEF,
      stateAt("emergence", { transmission: 28, surveillance: 48 }),
      outcome("contained_cluster")
    );
    const result = evaluateConflictTransitions(PANDEMIC_DEF, coordinated, 2020);

    expect(result.appliedTransitionKey).toBe("early_containment");
    expect(result.state.phaseLevel).toBe(4);
    expect(result.state.status).toBe("ceasefire");
  });

  it("lets an uncontrolled wave overwhelm capacity and become a pandemic", () => {
    const outbreak = applyConflictOutcome(
      PANDEMIC_DEF,
      stateAt("outbreak", { transmission: 62, healthCapacity: 50 }),
      outcome("uncontrolled_wave")
    );
    const result = evaluateConflictTransitions(PANDEMIC_DEF, outbreak, 2021);

    expect(result.appliedTransitionKey).toBe("global_spread");
    expect(result.state.phaseLevel).toBe(3);
    expect(result.state.tracks?.healthCapacity).toBe(38);
  });

  it("distinguishes cooperative research from an unequal rollout", () => {
    const researched = applyConflictOutcome(
      PANDEMIC_DEF,
      stateAt("pandemic", { vaccineResearch: 20, manufacturing: 10 }),
      outcome("research_acceleration")
    );
    const nationalized = applyConflictOutcome(
      PANDEMIC_DEF,
      researched,
      outcome("vaccine_nationalism")
    );

    expect(researched.tracks).toMatchObject({ vaccineResearch: 38, manufacturing: 22 });
    expect(nationalized.tracks).toMatchObject({ vaccineResearch: 46, manufacturing: 29 });
    expect(nationalized.tracks?.distributionEquity).toBe(2);
    expect(nationalized.tracks?.transmission).toBe(32);
  });

  it("supports an equitable endemic transition and a later immune-escape wave", () => {
    const rollout = applyConflictOutcome(
      PANDEMIC_DEF,
      stateAt("containment", { transmission: 24, immunity: 60, distributionEquity: 30 }),
      outcome("equitable_rollout")
    );
    const endemic = evaluateConflictTransitions(PANDEMIC_DEF, rollout, 2023);
    const relapse = evaluateConflictTransitions(
      PANDEMIC_DEF,
      stateAt("endemic", { transmission: 82, immunity: 50 }),
      2026
    );

    expect(endemic.appliedTransitionKey).toBe("endemic_transition");
    expect(endemic.state.status).toBe("settled");
    expect(relapse.appliedTransitionKey).toBe("endemic_escape");
    expect(relapse.state.phaseLevel).toBe(3);
    expect(relapse.state.status).toBe("active");
  });

  it("keeps background learning and repeated-wave pressure deterministic", () => {
    const pandemic = { ...stateAt("pandemic"), totalTurns: 12 };

    expect(scheduledPressureDeltas(PANDEMIC_DEF, pandemic, 2021)).toEqual({
      transmission: 4,
      restrictionFatigue: 3,
      supplyChainStrain: 2,
      vaccineResearch: 4,
      manufacturing: 2,
    });
  });
});
