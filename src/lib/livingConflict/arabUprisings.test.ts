import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
  scheduledPressureDeltas,
} from "./engine";
import { ARAB_UPRISINGS_DEF } from "./defs/arabUprisings";

function stateAt(phaseKey: string, tracks: Record<string, number> = {}) {
  const phase = ARAB_UPRISINGS_DEF.phases.find((item) => item.key === phaseKey);
  if (!phase) throw new Error(`Unknown phase: ${phaseKey}`);
  return normalizeConflictState(ARAB_UPRISINGS_DEF, {
    defKey: ARAB_UPRISINGS_DEF.key,
    hasOpened: true,
    openedYear: 2010,
    phaseLevel: phase.level,
    tracks,
  });
}

function outcome(id: string) {
  const found = ARAB_UPRISINGS_DEF.phases[0].events[0].response?.outcomes.find(
    (item) => item.outcomeId === id
  );
  if (!found) throw new Error(`Unknown outcome: ${id}`);
  return found;
}

describe("Arab uprisings living crisis", () => {
  it("diffuses pressure through one regional crisis", () => {
    expect(
      scheduledPressureDeltas(
        ARAB_UPRISINGS_DEF,
        { ...stateAt("structural_pressure"), totalTurns: 12 },
        2011
      )
    ).toEqual({ legitimacy: -4, protestMobilization: 5, civilianStrain: 3 });
    expect(ARAB_UPRISINGS_DEF.key).toBe("arab_uprisings");
  });

  it("supports successful reform", () => {
    const changed = applyConflictOutcome(
      ARAB_UPRISINGS_DEF,
      stateAt("protest_diffusion", { legitimacy: 38, protestMobilization: 42 }),
      outcome("successful_reform")
    );
    const result = evaluateConflictTransitions(ARAB_UPRISINGS_DEF, changed, 2011);
    expect(result.appliedTransitionKey).toBe("reform_success");
    expect(result.state.status).toBe("settled");
  });

  it("supports authoritarian survival with persistent legitimacy damage", () => {
    const changed = applyConflictOutcome(
      ARAB_UPRISINGS_DEF,
      stateAt("regime_choice", { repression: 54, eliteCohesion: 65, armedOpposition: 10 }),
      outcome("authoritarian_survival")
    );
    const result = evaluateConflictTransitions(ARAB_UPRISINGS_DEF, changed, 2012);
    expect(result.appliedTransitionKey).toBe("restored_control");
    expect(result.state.tracks?.legitimacy).toBe(24);
  });

  it("allows a negotiated transition", () => {
    const changed = applyConflictOutcome(
      ARAB_UPRISINGS_DEF,
      stateAt("regime_choice", { settlementMomentum: 45, repression: 45 }),
      outcome("negotiated_transition")
    );
    const result = evaluateConflictTransitions(ARAB_UPRISINGS_DEF, changed, 2012);
    expect(result.appliedTransitionKey).toBe("negotiated_transition");
    expect(result.state.status).toBe("negotiating");
  });

  it("makes civil war contingent on fragmentation and armed support", () => {
    const changed = applyConflictOutcome(
      ARAB_UPRISINGS_DEF,
      stateAt("regime_choice", { armedOpposition: 20, eliteCohesion: 55 }),
      outcome("civil_war")
    );
    const result = evaluateConflictTransitions(ARAB_UPRISINGS_DEF, changed, 2013);
    expect(result.appliedTransitionKey).toBe("war_begins");
    expect(result.state.tracks?.displacement).toBe(15);
  });

  it("permits a frozen conflict and preserves reconstruction obligations", () => {
    const result = evaluateConflictTransitions(
      ARAB_UPRISINGS_DEF,
      stateAt("civil_war", {
        settlementMomentum: 66,
        civilianStrain: 58,
        displacement: 44,
        reconstruction: 0,
      }),
      2018
    );
    expect(result.appliedTransitionKey).toBe("frozen_conflict");
    expect(result.state.status).toBe("ceasefire");
    expect(result.state.tracks?.displacement).toBe(44);
  });
});
