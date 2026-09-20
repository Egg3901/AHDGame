import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
} from "./engine";
import { GLOBAL_FINANCIAL_CRISIS_DEF } from "./defs/globalFinancialCrisis";

function stateAt(phaseKey: string, tracks: Record<string, number> = {}) {
  const phase = GLOBAL_FINANCIAL_CRISIS_DEF.phases.find((item) => item.key === phaseKey);
  if (!phase) throw new Error(`Unknown financial-crisis phase: ${phaseKey}`);
  return normalizeConflictState(GLOBAL_FINANCIAL_CRISIS_DEF, {
    defKey: GLOBAL_FINANCIAL_CRISIS_DEF.key,
    hasOpened: true,
    openedYear: 2008,
    phaseLevel: phase.level,
    tracks,
  });
}

function outcome(id: string) {
  const found = GLOBAL_FINANCIAL_CRISIS_DEF.phases[0].events[0].response?.outcomes.find(
    (item) => item.outcomeId === id
  );
  if (!found) throw new Error(`Unknown financial-crisis outcome: ${id}`);
  return found;
}

describe("global financial crisis living conflict", () => {
  it("uses a broad window and refuses to open from the date alone", () => {
    expect(GLOBAL_FINANCIAL_CRISIS_DEF.fromYear).toBe(2007);
    expect(GLOBAL_FINANCIAL_CRISIS_DEF.minimumOpeningPressure).toBe(60);
    const exposedOptions =
      GLOBAL_FINANCIAL_CRISIS_DEF.phases[0].events[0].response?.decisionTrees.belligerent?.options;
    expect(exposedOptions?.map((option) => option.action)).toEqual([
      { kind: "financialCrisisResponse", response: "recapitalize" },
      { kind: "financialCrisisResponse", response: "guarantee" },
      { kind: "financialCrisisResponse", response: "resolve" },
    ]);
  });

  it("allows early coordinated containment", () => {
    const contained = applyConflictOutcome(
      GLOBAL_FINANCIAL_CRISIS_DEF,
      stateAt("liquidity_stress", { liquidityStress: 40, marketConfidence: 55 }),
      outcome("coordinated_rescue")
    );
    const result = evaluateConflictTransitions(GLOBAL_FINANCIAL_CRISIS_DEF, contained, 2008);

    expect(result.appliedTransitionKey).toBe("early_containment");
    expect(result.state.status).toBe("settled");
  });

  it("lets fragmented policy cascade from failure into panic", () => {
    const failed = applyConflictOutcome(
      GLOBAL_FINANCIAL_CRISIS_DEF,
      stateAt("institutional_failure", { contagion: 35, marketConfidence: 50 }),
      outcome("cascading_failures")
    );
    const result = evaluateConflictTransitions(GLOBAL_FINANCIAL_CRISIS_DEF, failed, 2009);

    expect(result.appliedTransitionKey).toBe("panic_spreads");
    expect(result.state.phaseLevel).toBe(4);
  });

  it("makes stimulus support recovery while worsening sovereign spreads", () => {
    const changed = applyConflictOutcome(
      GLOBAL_FINANCIAL_CRISIS_DEF,
      stateAt("recession", { unemployment: 45, sovereignSpreads: 20, recovery: 20 }),
      outcome("stimulus_recovery")
    );

    expect(changed.tracks).toMatchObject({
      unemployment: 35,
      sovereignSpreads: 27,
      recovery: 34,
    });
  });

  it("makes austerity deepen unemployment rather than predetermine recovery", () => {
    const changed = applyConflictOutcome(
      GLOBAL_FINANCIAL_CRISIS_DEF,
      stateAt("recession", { unemployment: 35, householdDistress: 40, recovery: 30 }),
      outcome("austerity_spiral")
    );

    expect(changed.tracks).toMatchObject({
      unemployment: 47,
      householdDistress: 50,
      recovery: 20,
    });
  });

  it("supports sovereign stabilization and a later relapse", () => {
    const stabilized = evaluateConflictTransitions(
      GLOBAL_FINANCIAL_CRISIS_DEF,
      stateAt("sovereign_stress", {
        recovery: 65,
        sovereignSpreads: 30,
        creditorConsent: 55,
      }),
      2013
    );
    const relapse = evaluateConflictTransitions(
      GLOBAL_FINANCIAL_CRISIS_DEF,
      stateAt("stabilization", { sovereignSpreads: 65, contagion: 50 }),
      2015
    );

    expect(stabilized.appliedTransitionKey).toBe("sovereign_stabilization");
    expect(stabilized.state.status).toBe("settled");
    expect(relapse.appliedTransitionKey).toBe("relapse");
    expect(relapse.state.status).toBe("active");
  });
});
