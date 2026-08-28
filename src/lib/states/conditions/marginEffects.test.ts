import { describe, expect, it } from "vitest";
import {
  computeRegionalConditionMargin,
  defaultMarginEffectForApproval,
  marginEffectForModifier,
  REGIONAL_CONDITION_MARGIN_CAP,
} from "./marginEffects";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

describe("marginEffects", () => {
  describe("marginEffectForModifier", () => {
    it("returns zero for approval-only modifiers", () => {
      expect(marginEffectForModifier(2, "free_press")).toBe(0);
    });

    it("scales economic modifiers more strongly", () => {
      expect(marginEffectForModifier(2, "economic_boom")).toBe(2);
    });
  });

  describe("defaultMarginEffectForApproval", () => {
    it("scales approval delta by 75% to one decimal", () => {
      expect(defaultMarginEffectForApproval(2)).toBe(1.5);
      expect(defaultMarginEffectForApproval(-3)).toBe(-2.2);
      expect(defaultMarginEffectForApproval(1)).toBe(0.8);
    });
  });

  describe("computeRegionalConditionMargin", () => {
    it("sums metric modifier margin effects", () => {
      const modifiers: ActiveModifier[] = [
        { id: "a", label: "A", effect: 2, marginEffect: 1.5, source: "metric" },
        { id: "b", label: "B", effect: -1, marginEffect: -0.8, source: "metric" },
      ];
      expect(computeRegionalConditionMargin(modifiers)).toBe(0.7);
    });

    it("excludes address modifiers from the margin stack", () => {
      const modifiers: ActiveModifier[] = [
        { id: "a", label: "A", effect: 2, marginEffect: 1.5, source: "metric" },
        { id: "addr", label: "Address", effect: 3, source: "address" },
      ];
      expect(computeRegionalConditionMargin(modifiers)).toBe(1.5);
    });

    it("caps stacked margin at ±3pp", () => {
      const modifiers: ActiveModifier[] = Array.from({ length: 6 }, (_, i) => ({
        id: `m${i}`,
        label: `M${i}`,
        effect: 2,
        marginEffect: 1.5,
        source: "metric" as const,
      }));
      expect(computeRegionalConditionMargin(modifiers)).toBe(REGIONAL_CONDITION_MARGIN_CAP);
    });
  });

  describe("the war block", () => {
    /**
     * An unregistered id falls through to the 0.75 default factor, so a war
     * exhaustion of -25 would push -18.75 into corporate margins and clamp at
     * the -3 regional cap on every region of the country. Registration is
     * load-bearing, not belt and braces.
     */
    it("gives every war chip no profit margin effect", () => {
      for (const id of ["war", "war_exhaustion", "war_effort", "alliance_contribution"]) {
        expect(marginEffectForModifier(-25, id)).toBe(0);
      }
    });

    it("keeps the war modifier out of the regional condition margin sum", () => {
      const war: ActiveModifier = {
        id: "war",
        label: "War",
        effect: -25,
        marginEffect: 0,
        source: "war",
      };
      expect(computeRegionalConditionMargin([war])).toBe(0);
    });
  });
});
