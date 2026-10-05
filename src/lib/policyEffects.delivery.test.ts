import { describe, expect, it } from "vitest";
import type { LegislationType } from "./db/types";
import {
  calculateMetricTarget,
  computeTickRates,
  resolvePolicyDeliveryMultiplier,
  type ActivePolicy,
  type LegislationTypeMap,
} from "./policyEffects";

const managedType = {
  _id: "managed",
  name: "Managed fixture",
  effectTarget: { metricCategoryId: "education", metricId: "workforceSkill", scope: "state" },
  policyOptions: [
    {
      id: "option",
      effectDirection: 1,
      metricEffects: [{ category: "education", metricId: "workforceSkill", ratePerTurn: 2 }],
      implementation: {
        programId: "managed:option",
        fundingSemantics: "appropriation_included",
        appropriationClass: "operating",
        obligationPriority: 5,
      },
    },
  ],
} as unknown as LegislationType;

const policy = {
  stateId: "fixture",
  legislationTypeId: "managed",
  policyOptionId: "option",
  policyOptionIndex: 0,
  effectDirection: 1,
  scopeMultiplier: 1,
  deliveryMultiplier: 0.25,
} as unknown as ActivePolicy;

const types = new Map([[managedType._id, managedType]]) as LegislationTypeMap;

describe("legacy policy delivery scaling", () => {
  it("scales both decay targets and direct tick rates", () => {
    const fullTarget = calculateMetricTarget(
      null,
      "education",
      "workforceSkill",
      [{ ...policy, deliveryMultiplier: 1 }],
      types,
      1,
      50
    );
    const partialTarget = calculateMetricTarget(
      null,
      "education",
      "workforceSkill",
      [policy],
      types,
      1,
      50
    );
    expect(partialTarget - 50).toBeCloseTo((fullTarget - 50) * 0.25);
    expect(computeTickRates([policy], types).education?.workforceSkill).toBe(0.5);
  });

  it("fails a migrated program closed when its delivery record is absent", () => {
    expect(resolvePolicyDeliveryMultiplier(policy, types, new Map())).toBe(0);
    expect(resolvePolicyDeliveryMultiplier(policy, types, new Map([["managed", 0.4]]))).toBe(0.4);
  });

  it("preserves the legacy path for an option without program metadata", () => {
    const unmanaged = {
      ...managedType,
      _id: "unmanaged",
      policyOptions: [{ id: "option", effectDirection: 1 }],
    } as unknown as LegislationType;
    const unmanagedPolicy = {
      ...policy,
      legislationTypeId: "unmanaged",
    } as unknown as ActivePolicy;
    expect(
      resolvePolicyDeliveryMultiplier(
        unmanagedPolicy,
        new Map([[unmanaged._id, unmanaged]]),
        new Map()
      )
    ).toBe(1);
  });
});
