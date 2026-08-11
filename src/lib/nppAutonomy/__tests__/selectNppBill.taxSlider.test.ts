/**
 * Tax-slider sponsorship (ruling #16 deferred-item fix): slider laws carry no
 * options ladder, so selectNppBill synthesizes a directional stand-in — left
 * NPCs hike, right NPCs cut, an active fiscal stance overrides for fiscal
 * bills — and the propose command resolves the concrete rate later.
 */
import { describe, expect, it } from "vitest";
import type { LegislationType, NPP } from "@/lib/db/types";
import { selectNppBill, type ConditionsSignal } from "../selectNppBill";

function sliderType(id: string, policyDomain = "tax"): LegislationType {
  return {
    _id: id,
    name: `Tax ${id}`,
    description: "",
    policyDomain,
    subCategory: "tax",
    positions: [],
    taxSlider: {
      scope: "federal",
      taxType: "incomeTax",
      minRate: 0,
      maxRate: 60,
      step: 1,
      baselineRate: 35,
      waypoints: [],
    },
  } as unknown as LegislationType;
}

const noUrgency: ConditionsSignal = { weakDomains: {} };

describe("selectNppBill — tax sliders", () => {
  it("right-leaning NPCs sponsor cuts; left-leaning NPCs sponsor hikes", () => {
    const right = selectNppBill(
      [sliderType("t")],
      { policies: { economic: 4, social: 0 } } as NPP,
      noUrgency
    );
    expect(right?.taxSliderDirection).toBe(-1);
    expect(right?.option.economic).toBeGreaterThan(0); // cut reads rightward

    const left = selectNppBill(
      [sliderType("t")],
      { policies: { economic: -4, social: 0 } } as NPP,
      noUrgency
    );
    expect(left?.taxSliderDirection).toBe(1);
    expect(left?.option.economic).toBeLessThan(0);
  });

  it("a centrist NPC with no fiscal stance skips slider bills", () => {
    const sel = selectNppBill(
      [sliderType("t")],
      { policies: { economic: 0, social: 0 } } as NPP,
      noUrgency
    );
    expect(sel).toBeNull();
  });

  it("an active tightening stance overrides the lean for fiscal bills", () => {
    const sel = selectNppBill(
      [sliderType("t", "tax")],
      { policies: { economic: 4, social: 0 } } as NPP,
      noUrgency,
      undefined,
      { direction: 1, intensity: 0.8 }
    );
    expect(sel?.taxSliderDirection).toBe(1); // tighten = hike, despite the right lean
  });
});
