import { describe, it, expect } from "vitest";
import { roadConditionNode } from "./infrastructure";
import type { EngineNodeContext } from "../types";
import type { WarDamage } from "@/lib/military/warDamage";

const ID = "infrastructure.roadCondition";

function ctx(war: WarDamage | undefined, baseline = 78): EngineNodeContext {
  return {
    countryId: "DD",
    current: {},
    prev: { [ID]: baseline },
    prevSimBaseline: { [ID]: baseline },
    providers: war ? { warDamage: war } : {},
    spending: { infrastructure: 900 },
    policyValue: baseline,
  } as unknown as EngineNodeContext;
}

describe("roadCondition under war", () => {
  it("is bit-identical at peace, whether or not the provider is present", () => {
    // The safety property. Almost every country is at peace almost always, so a war
    // term that perturbed them would be a world-wide regression disguised as a feature.
    const absent = roadConditionNode.compute!(ctx(undefined));
    const atPeace = roadConditionNode.compute!(ctx({ frontProgress: 0 }));
    expect(atPeace).toBe(absent);
  });

  it("erodes the ground a war is fought across", () => {
    const peace = roadConditionNode.compute!(ctx(undefined));
    const war = roadConditionNode.compute!(ctx({ frontProgress: 1 }));
    expect(war).toBeLessThan(peace);
  });

  it("erodes further the more the front moves", () => {
    const quarter = roadConditionNode.compute!(ctx({ frontProgress: 0.25 }));
    const half = roadConditionNode.compute!(ctx({ frontProgress: 0.5 }));
    const total = roadConditionNode.compute!(ctx({ frontProgress: 1 }));
    expect(half).toBeLessThan(quarter);
    expect(total).toBeLessThan(half);
  });

  it("still floors at the reduced supported level rather than running to zero", () => {
    // maintenanceDecay floors at the target, so even a total war lands the stock on a
    // band rather than annihilating it. A country is wrecked, not deleted.
    const deep = roadConditionNode.compute!(ctx({ frontProgress: 1 }, 5));
    expect(deep).toBeGreaterThan(0);
    expect(deep).toBeGreaterThanOrEqual(5);
  });

  it("declares the provider it reads, so the phase actually supplies it", () => {
    // A node that reads a provider it does not declare gets undefined forever and the
    // feature silently does nothing.
    expect(roadConditionNode.inputs).toContainEqual({ provider: "warDamage" });
  });
});
