import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getWorldEntityOrThrow } from "@/lib/world/worldEntityManifest";
import { assertValidSphereMembership, resolvePrimarySponsor } from "@/lib/world/spheres";
import {
  DEFAULT_TRANSITION_PRESSURES,
  GOLD_COAST_ENTITY_ID,
  GHANA_ENTITY_ID,
  GOLD_COAST_TO_GHANA_RULE,
  GOLD_COAST_TO_GHANA_RULE_ID,
  applySovereigntyTransition,
  evaluateGoldCoastTransition,
  evaluateTransition,
  getGoldCoastTransitionDiagnostics,
  getGhanaMacroCountry,
  getGhanaSphereMembership,
  getTransitionRule,
  historicalPrior,
  runGoldCoastTransition,
} from "./index";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("Gold Coast → Ghana historical transition (#3726)", () => {
  describe("dependency record", () => {
    it("begins Gold Coast as a UK dependency in the 1953 manifest", () => {
      const goldCoast = getWorldEntityOrThrow("1953-default", GOLD_COAST_ENTITY_ID);
      expect(goldCoast).toMatchObject({
        entityId: "GC",
        displayName: "Gold Coast",
        status: "dependent",
        parentEntityId: "UK",
        simulationTier: "historical-presence",
        lifecycle: {
          earliestYear: 1954,
          expectedYear: 1957,
          latestYear: 1962,
          transitionRuleIds: [GOLD_COAST_TO_GHANA_RULE_ID],
        },
      });
      expect(goldCoast.sphere.relationships).toHaveLength(0);
    });

    it("authors the tracer rule with a non-forcing historical window", () => {
      const rule = getTransitionRule(GOLD_COAST_TO_GHANA_RULE_ID);
      expect(rule).toEqual(GOLD_COAST_TO_GHANA_RULE);
      expect(rule.window.expectedYear).toBe(1957);
      expect(rule.unAdmissionExpectedYear).toBe(1957);
      expect(rule.targetSimulationTier).toBe("sphere-macro");
    });
  });

  describe("default window path", () => {
    it("takes sovereignty in 1957 under baseline pressures without forcing earlier years", () => {
      const early = evaluateGoldCoastTransition(1953, 1);
      expect(early.outcome).toBe("hold");
      expect(early.un.state).toBe("ineligible");

      const atOpen = evaluateGoldCoastTransition(1954, 48);
      expect(atOpen.outcome).toBe("hold");

      const defaultPath = evaluateGoldCoastTransition(1957, 200);
      expect(defaultPath.outcome).toBe("sovereignty");
      expect(defaultPath.effectiveYear).toBe(1957);
      expect(defaultPath.rationale.some((line) => /historical default path/i.test(line))).toBe(
        true
      );
      expect(defaultPath.un.state).toBe("admitted");
    });

    it("is deterministic for the same simulation state", () => {
      const input = {
        ruleId: GOLD_COAST_TO_GHANA_RULE_ID,
        year: 1957,
        turn: 192,
        pressures: { ...DEFAULT_TRANSITION_PRESSURES },
      };
      const results = Array.from({ length: 20 }, () => evaluateTransition(input));
      expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    });

    it("keeps the historical prior below the sovereignty threshold before the expected year", () => {
      expect(historicalPrior(1955, GOLD_COAST_TO_GHANA_RULE.window)).toBeLessThan(0.35);
      expect(historicalPrior(1957, GOLD_COAST_TO_GHANA_RULE.window)).toBeGreaterThanOrEqual(0.35);
    });
  });

  describe("state pressures alter timing or outcome", () => {
    it("accelerates sovereignty before 1957 under high legitimacy and sphere pressure", () => {
      const accelerated = evaluateGoldCoastTransition(1955, 100, {
        legitimacy: 0.9,
        spherePressure: 0.85,
        parentCapacity: 0.25,
        unrest: 0.55,
        conflict: 0.05,
      });
      expect(accelerated.outcome).toBe("sovereignty");
      expect(accelerated.effectiveYear).toBe(1955);
      expect(accelerated.rationale.some((line) => /Accelerated sovereignty/i.test(line))).toBe(
        true
      );
    });

    it("delays sovereignty past 1957 when parent capacity and conflict dominate", () => {
      const delayed = evaluateGoldCoastTransition(1959, 300, {
        legitimacy: 0.25,
        unrest: 0.2,
        conflict: 0.45,
        parentCapacity: 0.9,
        spherePressure: 0.2,
      });
      expect(delayed.outcome).toBe("hold");
      expect(delayed.rationale.some((line) => /Holding past expected year/i.test(line))).toBe(true);
    });

    it("prevents sovereignty under extreme conflict", () => {
      const prevented = evaluateGoldCoastTransition(1957, 200, {
        ...DEFAULT_TRANSITION_PRESSURES,
        conflict: 0.92,
      });
      expect(prevented.outcome).toBe("prevented");
      expect(prevented.un.state).toBe("ineligible");
      expect(prevented.rationale.some((line) => /prevents sovereignty/i.test(line))).toBe(true);
    });

    it("prevents late unresolved cases when pressures stay deeply negative", () => {
      const prevented = evaluateGoldCoastTransition(1963, 500, {
        legitimacy: 0.15,
        unrest: 0.9,
        conflict: 0.55,
        parentCapacity: 0.95,
        spherePressure: 0.1,
      });
      expect(prevented.outcome).toBe("prevented");
    });
  });

  describe("successful sovereignty creates Ghana Tier-2 + sphere eligibility", () => {
    it("builds Ghana macro state and UK-primary sphere membership", async () => {
      const evaluation = evaluateGoldCoastTransition(1957, 192);
      const application = await applySovereigntyTransition(evaluation);

      expect(application.dissolvedEntityId).toBe(GOLD_COAST_ENTITY_ID);
      expect(application.sovereignEntity).toMatchObject({
        entityId: GHANA_ENTITY_ID,
        displayName: "Ghana",
        status: "sovereign",
        simulationTier: "sphere-macro",
        economicArchetype: "macro",
        sphere: { primarySphereId: "UK", canSponsor: false },
      });
      expect(application.sovereignEntity.parentEntityId).toBeUndefined();
      expect(application.sovereignEntity.simulationTier).not.toBe("full-autonomous");

      expect(application.macroSeed?.entityId).toBe(GHANA_ENTITY_ID);
      expect(application.macroSeed?.population).toBe(6_200_000);
      expect(application.macroSeed?.sectors.agriculture?.capacity).toBeGreaterThan(0);
      expect(application.macroSeed?.contribution.computedOnTurn).toBe(192);

      expect(application.sphereMembership?.primarySphereId).toBe("UK");
      expect(resolvePrimarySponsor(application.sphereMembership!)).toBe("UK");
      expect(() => assertValidSphereMembership(application.sphereMembership!)).not.toThrow();
      expect(application.sphereMembership!.relationships.some((r) => r.sponsorId === "US")).toBe(
        true
      );
    });

    it("persists the Ghana macro document when a db is provided", async () => {
      const db = createMockDb();
      db.collection("macroCountries");
      db.collectionMocks.macroCountries!.updateOne.mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
        upsertedId: GHANA_ENTITY_ID,
      });

      const { evaluation, application } = await runGoldCoastTransition(
        1957,
        192,
        {},
        { db: db as unknown as Db }
      );

      expect(evaluation.outcome).toBe("sovereignty");
      expect(application).not.toBeNull();
      expect(db.collectionMocks.macroCountries!.updateOne).toHaveBeenCalledTimes(1);
      const [, update] = db.collectionMocks.macroCountries!.updateOne.mock.calls[0]!;
      expect(update.$set.entityId).toBe(GHANA_ENTITY_ID);
      expect(update.$set.simulationTier).toBeUndefined();
      expect(update.$set.displayName).toBe("Ghana");
    });

    it("does not apply when the evaluation holds or prevents", async () => {
      const { application } = await runGoldCoastTransition(1953, 1);
      expect(application).toBeNull();
    });

    it("exposes a standalone Ghana macro seed helper", () => {
      const ghana = getGhanaMacroCountry(1);
      expect(ghana._id).toBe(GHANA_ENTITY_ID);
      expect(ghana.tradeExposure).toBeGreaterThan(0);
      expect(ghana.resources.timber).toBeGreaterThan(0);
    });

    it("exposes sphere eligibility for sovereign Ghana", () => {
      const membership = getGhanaSphereMembership();
      expect(membership.entityId).toBe(GHANA_ENTITY_ID);
      expect(membership.primarySphereId).toBe("UK");
    });
  });

  describe("UN lifecycle and rationale visibility", () => {
    it("keeps UN ineligible while dependent and admits on the default sovereignty path", () => {
      const hold = evaluateGoldCoastTransition(1956, 150);
      expect(hold.un.state).toBe("ineligible");
      expect(hold.un.rationale.some((line) => /ineligible until sovereignty/i.test(line))).toBe(
        true
      );

      const success = evaluateGoldCoastTransition(1957, 200);
      expect(success.un.state).toBe("admitted");
      expect(success.un.rationale.some((line) => /UN admission/i.test(line))).toBe(true);
    });

    it("delays UN admission when conflict remains high after sovereignty", () => {
      const early = evaluateGoldCoastTransition(1957, 200, {
        legitimacy: 0.95,
        spherePressure: 0.95,
        parentCapacity: 0.2,
        unrest: 0.5,
        conflict: 0.7,
      });
      expect(early.outcome).toBe("sovereignty");
      expect(early.un.state).toBe("eligible");
      expect(early.un.rationale.some((line) => /conflict delays UN/i.test(line))).toBe(true);
    });

    it("surfaces dependency, window, UN state, and rationale in diagnostics", () => {
      const diagnostics = getGoldCoastTransitionDiagnostics(1957, 200);
      expect(diagnostics.sourceEntityId).toBe(GOLD_COAST_ENTITY_ID);
      expect(diagnostics.parentEntityId).toBe("UK");
      expect(diagnostics.sourceStatus).toBe("dependent");
      expect(diagnostics.window.expectedYear).toBe(1957);
      expect(diagnostics.un.state).toBe("admitted");
      expect(diagnostics.lastEvaluation?.outcome).toBe("sovereignty");
      expect(diagnostics.rationale.length).toBeGreaterThan(3);
      expect(
        diagnostics.rationale.some((line) => /Gold Coast is dependent under parent UK/i.test(line))
      ).toBe(true);
    });
  });
});
