import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
  scheduledPressureDeltas,
} from "./engine";
import {
  terrorismOutcomeId,
  terrorismOptionRefusal,
  terrorismAnnualCost,
  terrorismEmergencyPowers,
  terrorismPoliticalEffects,
  terrorismAttackOutcome,
} from "./rules/transnationalTerrorism";
import { emptyCountryMemory } from "./campaign";
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

    expect(result.appliedTransitionKey).toBeNull();
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

describe("counterterrorism response rules", () => {
  it("keeps an immature plot unresolved without manufacturing an attack", () => {
    expect(terrorismOutcomeId(stateAt("network_formation"), {})).toBe("threat_persists");
    expect(terrorismOutcomeId(stateAt("normalization", { plotReadiness: 20 }), {})).toBe(
      "threat_persists"
    );
  });
  it("distinguishes limited and catastrophic breakthroughs from actual coverage", () => {
    expect(
      terrorismOutcomeId(
        stateAt("warning", { plotReadiness: 75, intelligenceCoverage: 50, threatCapability: 70 }),
        {}
      )
    ).toBe("limited_attack");
    expect(
      terrorismOutcomeId(
        stateAt("warning", { plotReadiness: 75, intelligenceCoverage: 20, threatCapability: 70 }),
        {}
      )
    ).toBe("attack_breakthrough");
    expect(
      terrorismOutcomeId(stateAt("warning", { plotReadiness: 90, intelligenceCoverage: 100 }), {})
    ).toBe("limited_attack");
  });
  it("lets active cooperation disrupt a ready plot and civilian policing degrade it", () => {
    const state = stateAt("warning", { plotReadiness: 90 });
    expect(terrorismOutcomeId(state, { intelligence: 8, policing: 5 })).toBe("plot_disrupted");
    expect(terrorismOutcomeId(state, { policing: 7, restraint: 3 })).toBe("policing_campaign");
  });
  it("gates military response and resolution on attribution", () => {
    const option =
      TRANSNATIONAL_TERRORISM_DEF.phases[0].events[0].response!.decisionTrees.belligerent!.options!.find(
        (o) => o.optionId === "military_response"
      )!;
    expect(
      terrorismOptionRefusal(stateAt("major_attack", { attributionConfidence: 44 }), option)
    ).toContain("45");
    expect(
      terrorismOptionRefusal(stateAt("major_attack", { attributionConfidence: 45 }), option)
    ).toBeNull();
    expect(
      terrorismOutcomeId(stateAt("major_attack", { attributionConfidence: 44 }), {
        intervention: 20,
        alliance: 20,
      })
    ).toBe("threat_persists");
  });
  it("charges only independently committed countries and keeps emergency authority until repeal", () => {
    const state = stateAt("military_campaign", { "emergencyPowers:US": 40, insurgency: 80 });
    state.campaign!.countryMemory.US = { ...emptyCountryMemory(), militaryCommitment: 30 };
    expect(terrorismAnnualCost(state, "US", 1_000_000)).toBe(3800);
    expect(terrorismAnnualCost(state, "DE", 1_000_000)).toBe(0);
    expect(terrorismPoliticalEffects(state, "US")["order.dueProcess"]).toBe(-3.2);
    expect(terrorismPoliticalEffects(state, "DE")).toEqual({});
    expect(terrorismEmergencyPowers(40, "defer_response")).toBe(40);
    expect(terrorismEmergencyPowers(40, "restore_law")).toBe(15);
  });
  it("displaces harm toward less prepared participating governments", () => {
    expect(
      terrorismAttackOutcome(outcome("limited_attack"), ["US", "UK"], { US: 7, UK: 0 }).target
    ).toBe("UK");
    expect(
      terrorismAttackOutcome(outcome("limited_attack"), ["US", "UK"], { US: 0, UK: 7 }).target
    ).toBe("US");
  });
  it("drawdown reduces insurgency and weariness rather than locking intervention at maximum", () => {
    const state = applyConflictOutcome(
      TRANSNATIONAL_TERRORISM_DEF,
      stateAt("insurgency", { insurgency: 90, warWeariness: 80, interventionCommitment: 90 }),
      outcome("drawdown")
    );
    expect(state.tracks).toMatchObject({
      insurgency: 78,
      warWeariness: 72,
      interventionCommitment: 75,
    });
  });
  it("silent governments add no free cooperation or military commitment", () => {
    const response = TRANSNATIONAL_TERRORISM_DEF.phases[0].events[0].response!;
    for (const [role, node] of Object.entries(response.decisionTrees)) {
      const option = node!.options!.find(
        (o) =>
          o.optionId ===
          response.defaultOptionIdByRole[role as keyof typeof response.defaultOptionIdByRole]
      );
      expect(option?.responseScores).toEqual({});
      expect(option?.campaignCommitment?.scale).toBe(0);
    }
  });
});
