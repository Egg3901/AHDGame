import { describe, expect, it } from "vitest";
import {
  checkFrontierGuardrails,
  frontierEntryCohortKey,
  frontierEntryControllerKey,
  frontierEntryEligible,
  frontierEntryExperimentEnabledFrom,
  frontierExperimentObservationsFromDiagnostics,
  isFrontierEntryRelaxableReason,
  FRONTIER_ENTRY_RELAXABLE_REASONS,
  recordFrontierEntry,
  summarizeFrontierExperiment,
  type FrontierEntrantObservation,
} from "./frontierEntryExperiment";

const open = {
  experimentEnabled: true,
  policyCleared: true,
  cohortKey: frontierEntryCohortKey("US", "PA"),
  controllerKey: "corp-a",
  enteredCohorts: new Set<string>(),
  enteredControllers: new Set<string>(),
  foundingCostPriced: true,
  financed: true,
};

describe("frontierEntryExperiment", () => {
  it("is disabled by default and fail-closed", () => {
    expect(frontierEntryExperimentEnabledFrom(undefined)).toBe(false);
    expect(frontierEntryExperimentEnabledFrom(false)).toBe(false);
    expect(frontierEntryExperimentEnabledFrom("true")).toBe(false);
    expect(frontierEntryExperimentEnabledFrom(true)).toBe(true);
    expect(frontierEntryEligible({ ...open, experimentEnabled: false })).toBe(false);
  });

  it("requires policy clearance and real priced financing", () => {
    expect(frontierEntryEligible({ ...open, policyCleared: false })).toBe(false);
    expect(frontierEntryEligible({ ...open, foundingCostPriced: false })).toBe(false);
    expect(frontierEntryEligible({ ...open, financed: false })).toBe(false);
    expect(frontierEntryEligible(open)).toBe(true);
  });

  it("caps one entrant per cohort and one per controller", () => {
    const enteredCohorts = new Set<string>();
    const enteredControllers = new Set<string>();
    recordFrontierEntry(enteredCohorts, enteredControllers, open.cohortKey, open.controllerKey);

    expect(frontierEntryEligible({ ...open, enteredCohorts, enteredControllers })).toBe(false);
    expect(
      frontierEntryEligible({
        ...open,
        cohortKey: frontierEntryCohortKey("US", "NY"),
        enteredCohorts,
        enteredControllers,
      })
    ).toBe(false);
    expect(
      frontierEntryEligible({
        ...open,
        cohortKey: frontierEntryCohortKey("US", "NY"),
        controllerKey: "corp-b",
        enteredCohorts,
        enteredControllers,
      })
    ).toBe(true);
  });

  it("resolves the controller through the formalized control link, not provenance", () => {
    expect(
      frontierEntryControllerKey({ corporationId: "corp-a", controllingCorporationId: "parent" })
    ).toBe("parent");
    expect(frontierEntryControllerKey({ corporationId: "corp-a" })).toBe("corp-a");
  });

  it("relaxes only expectational gates, never policy or physical ones", () => {
    expect(FRONTIER_ENTRY_RELAXABLE_REASONS).toEqual([
      "unprofitable",
      "margin_below_floor",
      "cash_floor",
    ]);
    expect(isFrontierEntryRelaxableReason("unprofitable")).toBe(true);
    expect(isFrontierEntryRelaxableReason("margin_below_floor")).toBe(true);
    expect(isFrontierEntryRelaxableReason("cash_floor")).toBe(true);
    for (const reason of [
      "entered",
      "strategy_disallowed",
      "no_enterable_market",
      "state_controlled",
      "logistics_capacity",
      "cohort_ineligible",
      "retail_paused",
      "glutted_market",
      "entry_cap",
      "facility_size",
      "founding_cost",
      "credit_requested",
      "state_credit_restricted",
    ]) {
      expect(isFrontierEntryRelaxableReason(reason)).toBe(false);
    }
  });

  it("derives rollback observations from marked funnel diagnostics only", () => {
    const diagnostics = [
      {
        reason: "entered",
        corporationId: "corp-a",
        countryId: "US",
        targetStateId: "PA",
        targetSectorType: "manufacturing",
        foundingCostLocal: 1000,
        frontierExperiment: { cohortKey: "US\0PA", controllerKey: "corp-a" },
      },
      {
        reason: "entered",
        corporationId: "corp-b",
        countryId: "US",
        targetStateId: "NY",
        foundingCostLocal: 2000,
      },
      {
        reason: "unprofitable",
        corporationId: "corp-c",
        countryId: "US",
        frontierExperiment: { cohortKey: "US\0OH", controllerKey: "corp-c" },
      },
    ];
    const observations = frontierExperimentObservationsFromDiagnostics({ turn: 7, diagnostics });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      turn: 7,
      cohortKey: "US\0PA",
      controllerKey: "corp-a",
      corporationId: "corp-a",
      foundingCostLocal: 1000,
      exit: "active",
    });
    const steady = summarizeFrontierExperiment({
      observations,
      guardrails: [{ name: "pooled fill", before: 0.7, after: 0.69, maxDecline: 0.05 }],
    });
    expect(steady.recommendation).toBe("continue");
    expect(steady.entrants).toBe(1);
    const breached = summarizeFrontierExperiment({
      observations,
      guardrails: [{ name: "pooled fill", before: 0.7, after: 0.6, maxDecline: 0.05 }],
    });
    expect(breached.recommendation).toBe("rollback");
  });

  it("rolls back on guardrail breach, never on entrant failure", () => {
    const observations: FrontierEntrantObservation[] = [
      {
        turn: 1,
        cohortKey: "US\u0000PA",
        controllerKey: "corp-a",
        corporationId: "corp-a",
        countryId: "US",
        stateId: "PA",
        sectorType: "manufacturing",
        foundingCostLocal: 1000,
        exit: "failed",
      },
    ];
    const steady = summarizeFrontierExperiment({
      observations,
      guardrails: [{ name: "pooled fill", before: 0.7, after: 0.69, maxDecline: 0.05 }],
    });
    expect(steady.recommendation).toBe("continue");
    expect(steady.exitedFailed).toBe(1);

    const breached = summarizeFrontierExperiment({
      observations: [],
      guardrails: [{ name: "pooled fill", before: 0.7, after: 0.6, maxDecline: 0.05 }],
    });
    expect(breached.recommendation).toBe("rollback");
    expect(breached.guardrailBreaches).toHaveLength(1);
    expect(checkFrontierGuardrails([])).toEqual([]);
  });
});
