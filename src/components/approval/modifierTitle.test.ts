import { describe, it, expect } from "vitest";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { buildModifierTitle, toneFor } from "./modifierTitle";

const war = (id: string, effect = 0): ActiveModifier => ({
  id,
  label: id,
  effect,
  marginEffect: 0,
  source: "war",
});

describe("toneFor", () => {
  it("reads a gain as positive", () => {
    expect(toneFor(1)).toBe("positive");
  });

  it("reads a loss as negative", () => {
    expect(toneFor(-2)).toBe("negative");
  });

  /**
   * The chip used to branch on `effect > 0` alone, so a war term that nets to
   * zero rendered in the same red as a two point penalty. A war currently
   * costing nothing is not punishing the government.
   */
  it("reads zero as neutral rather than as a penalty", () => {
    expect(toneFor(0)).toBe("neutral");
  });

  it("keeps a negative zero neutral", () => {
    expect(toneFor(-0)).toBe("neutral");
  });
});

describe("buildModifierTitle", () => {
  it("explains a metric condition", () => {
    expect(
      buildModifierTitle({ id: "strong_growth", label: "Strong Economic Growth", effect: 1 })
    ).toMatch(/metric thresholds/);
  });

  it("explains an address bump", () => {
    expect(
      buildModifierTitle({ id: "address:1", label: "Address", effect: 3, source: "address" })
    ).toMatch(/State of the State/);
  });

  /**
   * Three war chips, three different things being measured. A player looking at
   * a long war they are winning sees a positive effort chip beside a negative
   * exhaustion chip, and the tooltips have to say which is which or the split
   * has bought nothing.
   */
  it("gives each war term its own explanation", () => {
    const effort = buildModifierTitle(war("war_effort"));
    const exhaustion = buildModifierTitle(war("war_exhaustion"));
    const contribution = buildModifierTitle(war("alliance_contribution"));

    expect(effort).toMatch(/on the ground/);
    expect(exhaustion).toMatch(/how long the public has carried/i);
    expect(contribution).toMatch(/co-belligerents/);
    expect(new Set([effort, exhaustion, contribution]).size).toBe(3);
  });

  it("tells the player exhaustion carries into the next war", () => {
    expect(buildModifierTitle(war("war_exhaustion"))).toMatch(/next war/);
  });

  it("falls back to a generic war explanation for an unknown war id", () => {
    expect(buildModifierTitle(war("war_something_new"))).toMatch(/How the war is going/);
  });

  it("writes player facing copy without dashes", () => {
    for (const id of ["war_effort", "war_exhaustion", "alliance_contribution"]) {
      expect(buildModifierTitle(war(id))).not.toMatch(/[–—]/);
    }
  });
});
