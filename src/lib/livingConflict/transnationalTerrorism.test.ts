import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
  scheduledPressureDeltas,
} from "./engine";
import { TRANSNATIONAL_TERRORISM_DEF } from "./defs/transnationalTerrorism";

function stateAt(phaseKey: string, tracks: Record<string, number> = {}) {
  const phase = TRANSNATIONAL_TERRORISM_DEF.phases.find((candidate) => candidate.key === phaseKey);
  if (!phase) throw new Error(`Unknown terrorism phase: ${phaseKey}`);
  return normalizeConflictState(TRANSNATIONAL_TERRORISM_DEF, {
    defKey: TRANSNATIONAL_TERRORISM_DEF.key,
    hasOpened: true,
    openedYear: 1998,
    phaseLevel: phase.level,
    tracks,
  });
}

function outcome(id: string) {
  const found = TRANSNATIONAL_TERRORISM_DEF.phases[0].events[0].response?.outcomes.find(
    (candidate) => candidate.outcomeId === id
  );
  if (!found) throw new Error(`Unknown terrorism outcome: ${id}`);
  return found;
}

describe("transnational terrorism living conflict", () => {
  it("creates pressure around the millennium without scripting an attack date", () => {
    const forming = { ...stateAt("network_formation"), totalTurns: 12 };

    expect(TRANSNATIONAL_TERRORISM_DEF.fromYear).toBe(1998);
    expect(scheduledPressureDeltas(TRANSNATIONAL_TERRORISM_DEF, forming, 2001)).toEqual({
      threatCapability: 4,
      plotReadiness: 5,
    });
    expect(
      TRANSNATIONAL_TERRORISM_DEF.transitions?.find((item) => item.key === "major_attack")
        ?.earliestYear
    ).toBeUndefined();
  });

  it("allows intelligence and policing to prevent a major attack", () => {
    const warning = stateAt("warning", {
      intelligenceCoverage: 55,
      threatCapability: 44,
      plotReadiness: 58,
    });
    const disrupted = applyConflictOutcome(
      TRANSNATIONAL_TERRORISM_DEF,
      warning,
      outcome("plot_disrupted")
    );
    const result = evaluateConflictTransitions(TRANSNATIONAL_TERRORISM_DEF, disrupted, 2002);

    expect(result.appliedTransitionKey).toBe("prevent_attack");
    expect(result.state.phaseLevel).toBe(6);
  });

  it("permits a catastrophic breakthrough when plots outrun coverage", () => {
    const warning = applyConflictOutcome(
      TRANSNATIONAL_TERRORISM_DEF,
      stateAt("warning", { plotReadiness: 60, intelligenceCoverage: 35 }),
      outcome("attack_breakthrough")
    );
    const result = evaluateConflictTransitions(TRANSNATIONAL_TERRORISM_DEF, warning, 2004);

    expect(result.appliedTransitionKey).toBe("major_attack");
    expect(result.state.phaseLevel).toBe(3);
  });

  it("makes intervention degrade capability while generating blowback", () => {
    const changed = applyConflictOutcome(
      TRANSNATIONAL_TERRORISM_DEF,
      stateAt("major_attack", { threatCapability: 60, insurgency: 10 }),
      outcome("military_intervention")
    );

    expect(changed.tracks).toMatchObject({
      threatCapability: 52,
      interventionCommitment: 18,
      insurgency: 24,
      warWeariness: 8,
    });
  });

  it("supports normalization and renewed threat rather than permanent maximum alert", () => {
    const normalized = evaluateConflictTransitions(
      TRANSNATIONAL_TERRORISM_DEF,
      stateAt("network_degradation", {
        threatCapability: 18,
        plotReadiness: 20,
        publicFear: 30,
      }),
      2015
    );
    const relapse = evaluateConflictTransitions(
      TRANSNATIONAL_TERRORISM_DEF,
      stateAt("normalization", { threatCapability: 50, plotReadiness: 48 }),
      2020
    );

    expect(normalized.appliedTransitionKey).toBe("normalize");
    expect(normalized.state.status).toBe("settled");
    expect(relapse.appliedTransitionKey).toBe("renewed_threat");
    expect(relapse.state.status).toBe("active");
  });
});
