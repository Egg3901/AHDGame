import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
  resolveConflictParticipants,
  scheduledPressureDeltas,
} from "./engine";
import { YUGOSLAVIA_DEF } from "./defs/yugoslavia";

function stateAt(phaseKey: string, tracks: Record<string, number> = {}) {
  const phase = YUGOSLAVIA_DEF.phases.find((candidate) => candidate.key === phaseKey);
  if (!phase) throw new Error(`Unknown Yugoslavia phase: ${phaseKey}`);
  return normalizeConflictState(YUGOSLAVIA_DEF, {
    defKey: YUGOSLAVIA_DEF.key,
    hasOpened: true,
    openedYear: 1991,
    phaseLevel: phase.level,
    tracks,
  });
}

function outcome(id: string) {
  const found = YUGOSLAVIA_DEF.phases[0].events[0].response?.outcomes.find(
    (candidate) => candidate.outcomeId === id
  );
  if (!found) throw new Error(`Unknown Yugoslavia outcome: ${id}`);
  return found;
}

describe("Yugoslav dissolution living conflict", () => {
  it("opens automatically with fixed 1991 pressures but no forced borders", () => {
    expect(YUGOSLAVIA_DEF.fromYear).toBe(1991);
    expect(YUGOSLAVIA_DEF.autoOpen).toBe(true);
    expect(YUGOSLAVIA_DEF.phases.map((phase) => phase.key)).toEqual([
      "federal_crisis",
      "declarations",
      "armed_conflict",
      "international_intervention",
      "settlement",
      "reconstruction",
    ]);
    expect(YUGOSLAVIA_DEF.tracks).toMatchObject({
      constitutionalCohesion: { initial: 34 },
      nationalistMobilization: { initial: 58 },
      violence: { initial: 12 },
      displacement: { initial: 0 },
    });
  });

  it("applies constitutional pressure inside its historical window", () => {
    const federalCrisis = { ...stateAt("federal_crisis"), totalTurns: 12 };

    expect(scheduledPressureDeltas(YUGOSLAVIA_DEF, federalCrisis, 1991)).toEqual({
      constitutionalCohesion: -3,
      nationalistMobilization: 3,
    });
    expect(scheduledPressureDeltas(YUGOSLAVIA_DEF, federalCrisis, 1996)).toEqual({});
  });

  it("supports negotiated reform without requiring a war", () => {
    const declarations = stateAt("declarations", {
      constitutionalCohesion: 42,
      nationalistMobilization: 61,
      violence: 20,
      settlementMomentum: 30,
    });
    const negotiated = applyConflictOutcome(
      YUGOSLAVIA_DEF,
      declarations,
      outcome("negotiated_restructuring")
    );
    const result = evaluateConflictTransitions(YUGOSLAVIA_DEF, negotiated, 1992);

    expect(result.appliedTransitionKey).toBe("reform_holds_federation");
    expect(result.state.phaseLevel).toBe(1);
    expect(result.state.status).toBe("negotiating");
  });

  it("allows coercion and arming to turn declarations into war", () => {
    const declarations = stateAt("declarations", { violence: 30 });
    const firstEscalation = applyConflictOutcome(
      YUGOSLAVIA_DEF,
      declarations,
      outcome("military_escalation")
    );
    const result = evaluateConflictTransitions(YUGOSLAVIA_DEF, firstEscalation, 1992);

    expect(firstEscalation.tracks?.violence).toBe(48);
    expect(result.appliedTransitionKey).toBe("war_begins");
    expect(result.state.phaseLevel).toBe(3);
  });

  it("connects intervention to civilian protection and a possible settlement", () => {
    const intervention = applyConflictOutcome(
      YUGOSLAVIA_DEF,
      stateAt("international_intervention", {
        violence: 50,
        displacement: 45,
        settlementMomentum: 62,
      }),
      outcome("international_intervention")
    );
    const result = evaluateConflictTransitions(YUGOSLAVIA_DEF, intervention, 1995);

    expect(intervention.tracks).toMatchObject({
      violence: 42,
      displacement: 40,
      intervention: 18,
      settlementMomentum: 74,
    });
    expect(result.appliedTransitionKey).toBe("intervention_settlement");
    expect(result.state.status).toBe("settled");
  });

  it("permits both reconstruction and a settlement relapse", () => {
    const reconstruction = evaluateConflictTransitions(
      YUGOSLAVIA_DEF,
      stateAt("settlement", { reconstruction: 36, violence: 20 }),
      1998
    );
    const relapse = evaluateConflictTransitions(
      YUGOSLAVIA_DEF,
      stateAt("settlement", { reconstruction: 50, violence: 70 }),
      1998
    );

    expect(reconstruction.appliedTransitionKey).toBe("reconstruction_begins");
    expect(reconstruction.state.phaseLevel).toBe(6);
    expect(relapse.appliedTransitionKey).toBe("settlement_relapse");
    expect(relapse.state.phaseLevel).toBe(3);
    expect(relapse.state.status).toBe("active");
  });

  it("substitutes surviving powers when historical actors do not exist", () => {
    const participants = resolveConflictParticipants(
      YUGOSLAVIA_DEF,
      new Set(["CS", "CN", "FR", "AT", "IT", "GR", "DE", "TR"])
    );

    expect(participants.belligerents).toEqual(["CS"]);
    expect(participants.backerA).toBe("FR");
    expect(participants.backerB).toBe("CN");
  });

  it("offers sanctions, peacekeeping, relief, mediation, and military choices", () => {
    const response = YUGOSLAVIA_DEF.phases[0].events[0].response;
    const optionIds = Object.values(response?.decisionTrees ?? {}).flatMap(
      (node) => node.options?.map((option) => option.optionId) ?? []
    );

    expect(optionIds).toEqual(
      expect.arrayContaining([
        "coerce",
        "west_mediate",
        "receive_refugees",
        "sanctions",
        "peacekeeping",
        "civilian_relief",
      ])
    );
  });
});
