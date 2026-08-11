import { describe, expect, it } from "vitest";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { assertValidSphereMembership, resolvePrimarySponsor } from "@/lib/world/spheres";
import {
  ADEN_PROTECTORATE_ENTITY_ID,
  ADEN_TO_SOUTH_YEMEN_RULE,
  ADEN_TO_SOUTH_YEMEN_RULE_ID,
  ALGERIA_ENTITY_ID,
  ANGOLA_ENTITY_ID,
  applySovereigntyTransition,
  BELGIAN_CONGO_ENTITY_ID,
  BELGIAN_CONGO_TO_CONGO_RULE,
  BELGIAN_CONGO_TO_CONGO_RULE_ID,
  BRITISH_GUIANA_ENTITY_ID,
  BRITISH_GUIANA_TO_GUYANA_RULE,
  BRITISH_GUIANA_TO_GUYANA_RULE_ID,
  CONGO_ENTITY_ID,
  DECOLONIZATION_ROSTER_RULE_IDS,
  DEFAULT_TRANSITION_PRESSURES,
  evaluateTransition,
  evaluateTransitionWithDefaults,
  FRENCH_ALGERIA_ENTITY_ID,
  FRENCH_ALGERIA_TO_ALGERIA_RULE,
  FRENCH_ALGERIA_TO_ALGERIA_RULE_ID,
  getTransitionDiagnostics,
  getTransitionMacroCountry,
  getTransitionRule,
  GUYANA_ENTITY_ID,
  historicalPrior,
  MOZAMBIQUE_ENTITY_ID,
  PORTUGUESE_ANGOLA_ENTITY_ID,
  PORTUGUESE_ANGOLA_TO_ANGOLA_RULE,
  PORTUGUESE_ANGOLA_TO_ANGOLA_RULE_ID,
  PORTUGUESE_MOZAMBIQUE_ENTITY_ID,
  PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE,
  PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE_ID,
  runTransition,
  SOMALIA_ENTITY_ID,
  SOMALIA_TRUST_ENTITY_ID,
  SOMALIA_TRUST_TO_SOMALIA_RULE,
  SOMALIA_TRUST_TO_SOMALIA_RULE_ID,
  SOUTH_YEMEN_ENTITY_ID,
  type TransitionRule,
} from "./index";

interface RosterCase {
  label: string;
  rule: TransitionRule;
  sourceEntityId: string;
  sourceDisplayName: string;
  parentEntityId: string;
  coParentEntityIds?: readonly string[];
  targetEntityId: string;
  targetDisplayName: string;
  expectedYear: number;
  primarySphereId: string;
  /** Year inside the window, before expected, where acceleration pressures succeed. */
  accelerateYear: number;
  /** Year after expected where delay pressures still hold. */
  delayYear: number;
  /** Year past latest where deeply negative pressures prevent. */
  preventLateYear: number;
}

const ACCELERATE_PRESSURES = {
  legitimacy: 0.9,
  spherePressure: 0.85,
  parentCapacity: 0.25,
  unrest: 0.55,
  conflict: 0.05,
};

const DELAY_PRESSURES = {
  legitimacy: 0.25,
  unrest: 0.2,
  conflict: 0.45,
  parentCapacity: 0.9,
  spherePressure: 0.2,
};

const LATE_PREVENT_PRESSURES = {
  legitimacy: 0.15,
  unrest: 0.9,
  conflict: 0.55,
  parentCapacity: 0.95,
  spherePressure: 0.1,
};

const ROSTER: RosterCase[] = [
  {
    label: "Somalia",
    rule: SOMALIA_TRUST_TO_SOMALIA_RULE,
    sourceEntityId: SOMALIA_TRUST_ENTITY_ID,
    sourceDisplayName: "Somalia Trust Territories",
    parentEntityId: "IT",
    coParentEntityIds: ["UK"],
    targetEntityId: SOMALIA_ENTITY_ID,
    targetDisplayName: "Somalia",
    expectedYear: 1960,
    primarySphereId: "US",
    accelerateYear: 1959,
    delayYear: 1962,
    preventLateYear: 1966,
  },
  {
    label: "Congo",
    rule: BELGIAN_CONGO_TO_CONGO_RULE,
    sourceEntityId: BELGIAN_CONGO_ENTITY_ID,
    sourceDisplayName: "Belgian Congo",
    parentEntityId: "BE",
    targetEntityId: CONGO_ENTITY_ID,
    targetDisplayName: "Congo",
    expectedYear: 1960,
    primarySphereId: "US",
    accelerateYear: 1959,
    delayYear: 1962,
    preventLateYear: 1966,
  },
  {
    label: "Algeria",
    rule: FRENCH_ALGERIA_TO_ALGERIA_RULE,
    sourceEntityId: FRENCH_ALGERIA_ENTITY_ID,
    sourceDisplayName: "French Algeria",
    parentEntityId: "FR",
    targetEntityId: ALGERIA_ENTITY_ID,
    targetDisplayName: "Algeria",
    expectedYear: 1962,
    primarySphereId: "FR",
    accelerateYear: 1960,
    delayYear: 1964,
    preventLateYear: 1968,
  },
  {
    label: "Guyana",
    rule: BRITISH_GUIANA_TO_GUYANA_RULE,
    sourceEntityId: BRITISH_GUIANA_ENTITY_ID,
    sourceDisplayName: "British Guiana",
    parentEntityId: "UK",
    targetEntityId: GUYANA_ENTITY_ID,
    targetDisplayName: "Guyana",
    expectedYear: 1966,
    primarySphereId: "UK",
    accelerateYear: 1963,
    delayYear: 1968,
    preventLateYear: 1972,
  },
  {
    label: "South Yemen",
    rule: ADEN_TO_SOUTH_YEMEN_RULE,
    sourceEntityId: ADEN_PROTECTORATE_ENTITY_ID,
    sourceDisplayName: "Aden Protectorate",
    parentEntityId: "UK",
    targetEntityId: SOUTH_YEMEN_ENTITY_ID,
    targetDisplayName: "South Yemen",
    expectedYear: 1967,
    primarySphereId: "RU",
    accelerateYear: 1965,
    delayYear: 1969,
    preventLateYear: 1973,
  },
  {
    label: "Angola",
    rule: PORTUGUESE_ANGOLA_TO_ANGOLA_RULE,
    sourceEntityId: PORTUGUESE_ANGOLA_ENTITY_ID,
    sourceDisplayName: "Portuguese Angola",
    parentEntityId: "PT",
    targetEntityId: ANGOLA_ENTITY_ID,
    targetDisplayName: "Angola",
    expectedYear: 1975,
    primarySphereId: "RU",
    accelerateYear: 1972,
    delayYear: 1977,
    preventLateYear: 1981,
  },
  {
    label: "Mozambique",
    rule: PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE,
    sourceEntityId: PORTUGUESE_MOZAMBIQUE_ENTITY_ID,
    sourceDisplayName: "Portuguese Mozambique",
    parentEntityId: "PT",
    targetEntityId: MOZAMBIQUE_ENTITY_ID,
    targetDisplayName: "Mozambique",
    expectedYear: 1975,
    primarySphereId: "RU",
    accelerateYear: 1972,
    delayYear: 1977,
    preventLateYear: 1981,
  },
];

describe("Approved decolonization roster (#3727)", () => {
  it("registers all seven approved cases beside the Ghana tracer", () => {
    expect(DECOLONIZATION_ROSTER_RULE_IDS).toHaveLength(7);
    expect(DECOLONIZATION_ROSTER_RULE_IDS).toEqual([
      SOMALIA_TRUST_TO_SOMALIA_RULE_ID,
      BELGIAN_CONGO_TO_CONGO_RULE_ID,
      FRENCH_ALGERIA_TO_ALGERIA_RULE_ID,
      BRITISH_GUIANA_TO_GUYANA_RULE_ID,
      ADEN_TO_SOUTH_YEMEN_RULE_ID,
      PORTUGUESE_ANGOLA_TO_ANGOLA_RULE_ID,
      PORTUGUESE_MOZAMBIQUE_TO_MOZAMBIQUE_RULE_ID,
    ]);
  });

  for (const caseSpec of ROSTER) {
    describe(caseSpec.label, () => {
      it("has an era-correct dependency record and window", () => {
        const source = getWorldEntityOrThrow("1953-default", caseSpec.sourceEntityId);
        expect(source).toMatchObject({
          entityId: caseSpec.sourceEntityId,
          displayName: caseSpec.sourceDisplayName,
          status: "dependent",
          parentEntityId: caseSpec.parentEntityId,
          simulationTier: "historical-presence",
          lifecycle: {
            earliestYear: caseSpec.rule.window.earliestYear,
            expectedYear: caseSpec.expectedYear,
            latestYear: caseSpec.rule.window.latestYear,
            transitionRuleIds: [caseSpec.rule.ruleId],
          },
        });
        if (caseSpec.coParentEntityIds) {
          expect(source.coParentEntityIds).toEqual(caseSpec.coParentEntityIds);
        } else {
          expect(source.coParentEntityIds).toBeUndefined();
        }

        const target = getWorldEntityOrThrow("1953-default", caseSpec.targetEntityId);
        expect(target).toMatchObject({
          entityId: caseSpec.targetEntityId,
          displayName: caseSpec.targetDisplayName,
          status: "emergent",
          simulationTier: "sphere-macro",
          sphere: { primarySphereId: caseSpec.primarySphereId, canSponsor: false },
          lifecycle: {
            expectedYear: caseSpec.expectedYear,
            transitionRuleIds: [caseSpec.rule.ruleId],
          },
        });

        const rule = getTransitionRule(caseSpec.rule.ruleId);
        expect(rule).toEqual(caseSpec.rule);
        expect(rule.window.expectedYear).toBe(caseSpec.expectedYear);
        expect(rule.targetSimulationTier).toBe("sphere-macro");
        expect(rule.targetSimulationTier).not.toBe("full-autonomous");
      });

      it("takes sovereignty on the historical default path under baseline pressures", () => {
        const before = evaluateTransitionWithDefaults(
          caseSpec.rule.ruleId,
          caseSpec.rule.window.earliestYear - 2,
          1
        );
        expect(before.outcome).toBe("hold");
        expect(before.un.state).toBe("ineligible");

        const defaultPath = evaluateTransitionWithDefaults(
          caseSpec.rule.ruleId,
          caseSpec.expectedYear,
          200
        );
        expect(defaultPath.outcome).toBe("sovereignty");
        expect(defaultPath.effectiveYear).toBe(caseSpec.expectedYear);
        expect(defaultPath.un.state).toBe("admitted");
        expect(historicalPrior(caseSpec.expectedYear, caseSpec.rule.window)).toBeGreaterThanOrEqual(
          0.35
        );
      });

      it("is deterministic for the same simulation state", () => {
        const input = {
          ruleId: caseSpec.rule.ruleId,
          year: caseSpec.expectedYear,
          turn: 192,
          pressures: { ...DEFAULT_TRANSITION_PRESSURES },
        };
        const results = Array.from({ length: 20 }, () => evaluateTransition(input));
        expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
      });

      it("supports accelerated, delayed, and prevented outcomes", () => {
        const accelerated = evaluateTransitionWithDefaults(
          caseSpec.rule.ruleId,
          caseSpec.accelerateYear,
          100,
          ACCELERATE_PRESSURES
        );
        expect(accelerated.outcome).toBe("sovereignty");
        expect(accelerated.effectiveYear).toBe(caseSpec.accelerateYear);
        expect(accelerated.rationale.some((line) => /Accelerated sovereignty/i.test(line))).toBe(
          true
        );

        const delayed = evaluateTransitionWithDefaults(
          caseSpec.rule.ruleId,
          caseSpec.delayYear,
          300,
          DELAY_PRESSURES
        );
        expect(delayed.outcome).toBe("hold");
        expect(delayed.rationale.some((line) => /Holding past expected year/i.test(line))).toBe(
          true
        );

        const prevented = evaluateTransitionWithDefaults(
          caseSpec.rule.ruleId,
          caseSpec.expectedYear,
          200,
          { ...DEFAULT_TRANSITION_PRESSURES, conflict: 0.92 }
        );
        expect(prevented.outcome).toBe("prevented");
        expect(prevented.un.state).toBe("ineligible");

        const latePrevented = evaluateTransitionWithDefaults(
          caseSpec.rule.ruleId,
          caseSpec.preventLateYear,
          500,
          LATE_PREVENT_PRESSURES
        );
        expect(latePrevented.outcome).toBe("prevented");
      });

      it("grants only configured Tier-2 behavior with UN and sphere eligibility — never Tier-1", async () => {
        const evaluation = evaluateTransitionWithDefaults(
          caseSpec.rule.ruleId,
          caseSpec.expectedYear,
          192
        );
        const application = await applySovereigntyTransition(evaluation);

        expect(application.dissolvedEntityId).toBe(caseSpec.sourceEntityId);
        expect(application.sovereignEntity).toMatchObject({
          entityId: caseSpec.targetEntityId,
          displayName: caseSpec.targetDisplayName,
          status: "sovereign",
          simulationTier: "sphere-macro",
          economicArchetype: "macro",
          sphere: { primarySphereId: caseSpec.primarySphereId, canSponsor: false },
        });
        expect(application.sovereignEntity.parentEntityId).toBeUndefined();
        expect(application.sovereignEntity.simulationTier).not.toBe("full-autonomous");
        expect(application.sovereignEntity.readiness.autonomous).toBe("blocked");
        expect(application.sovereignEntity.readiness.player).toBe("blocked");

        expect(application.macroSeed?.entityId).toBe(caseSpec.targetEntityId);
        expect(application.macroSeed?.population).toBeGreaterThan(0);
        expect(application.macroSeed?.contribution.computedOnTurn).toBe(192);

        expect(application.sphereMembership).not.toBeNull();
        expect(application.sphereMembership!.primarySphereId).toBe(caseSpec.primarySphereId);
        expect(resolvePrimarySponsor(application.sphereMembership!)).toBe(caseSpec.primarySphereId);
        expect(() => assertValidSphereMembership(application.sphereMembership!)).not.toThrow();

        expect(application.un.state).toBe("admitted");

        const standalone = getTransitionMacroCountry(caseSpec.targetEntityId, 1);
        expect(standalone?.entityId).toBe(caseSpec.targetEntityId);
      });

      it("does not apply when held or prevented, and surfaces diagnostics", async () => {
        const { application } = await runTransition(
          caseSpec.rule.ruleId,
          caseSpec.rule.window.earliestYear - 3,
          1
        );
        expect(application).toBeNull();

        const diagnostics = getTransitionDiagnostics(
          caseSpec.rule.ruleId,
          caseSpec.expectedYear,
          200
        );
        expect(diagnostics.sourceEntityId).toBe(caseSpec.sourceEntityId);
        expect(diagnostics.parentEntityId).toBe(caseSpec.parentEntityId);
        expect(diagnostics.sourceStatus).toBe("dependent");
        expect(diagnostics.window.expectedYear).toBe(caseSpec.expectedYear);
        expect(diagnostics.un.state).toBe("admitted");
        expect(diagnostics.lastEvaluation?.outcome).toBe("sovereignty");
        expect(
          diagnostics.rationale.some((line) =>
            new RegExp(`${caseSpec.sourceDisplayName} is dependent under parent`, "i").test(line)
          )
        ).toBe(true);
      });
    });
  }
});
