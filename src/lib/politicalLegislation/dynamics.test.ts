import { describe, expect, it } from "vitest";
import { getCatalog } from "./catalog";
import {
  composeTarget,
  driftStep,
  DRIFT_RATE_PER_TURN,
  lawTargets,
  metricModifierRows,
  structuralResidual,
} from "./dynamics";

function levelsFromBaselines(countryId: "US" | "UK" | "RU") {
  return new Map(
    getCatalog(countryId)
      .filter((l) => l.kind !== "tax")
      .map((l) => [l.id, l.baselineLevel ?? 0])
  );
}

describe("lawTargets (§2 goldens)", () => {
  it("UK NHS L4 primary contributes exactly 50.0 to health.universalCare", () => {
    const levels = new Map([["uk.health.universalCare.primary", 4]]);
    expect(lawTargets("UK", levels)["health.universalCare"]).toBe(50);
  });

  it("a 0.5-weight secondary at L3 contributes 7.5", () => {
    // us.sec.nationalHighwaysFreight leads infrastructure.highways ×0.5
    const levels = new Map([["us.sec.nationalHighwaysFreight", 3]]);
    expect(lawTargets("US", levels)["infrastructure.highways"]).toBe(7.5);
  });

  it("tax laws and missing laws contribute nothing", () => {
    const levels = new Map([["uk.tax.incomeTax", 4]]);
    const targets = lawTargets("UK", levels);
    for (const points of Object.values(targets)) expect(points).toBe(0);
  });

  it("primary + secondaries stack per the catalog weights (independent recompute)", () => {
    const levels = levelsFromBaselines("UK");
    let expected = 0;
    for (const law of getCatalog("UK")) {
      if (law.kind === "tax") continue;
      const level = levels.get(law.id) ?? 0;
      for (const t of law.targets) {
        if (t.metricId !== "health.universalCare") continue;
        expected += law.kind === "primary" ? 12.5 * level : 5 * level * t.weight;
      }
    }
    expect(lawTargets("UK", levels)["health.universalCare"]).toBeCloseTo(expected, 9);
  });
});

describe("composeTarget (§2)", () => {
  it("adds half the regional supplement", () => {
    expect(composeTarget(40, 50, 0)).toBe(65); // 40 + 25
  });
  it("carries the residual and clamps to [0,100]", () => {
    expect(composeTarget(50, 0, 60)).toBe(100);
    expect(composeTarget(0, 0, -20)).toBe(0);
    expect(composeTarget(30, 10, -5)).toBe(30); // 30 + 5 − 5
  });
});

describe("driftStep (§2.1)", () => {
  it("moves the configured fraction of the gap per turn", () => {
    // Ticket #1129 retune: 0.005 (138 turn half-life) read as nothing moving.
    expect(DRIFT_RATE_PER_TURN).toBe(0.02);
    expect(driftStep(50, 100)).toBeCloseTo(50 + 50 * DRIFT_RATE_PER_TURN, 9);
    expect(driftStep(50, 0)).toBeCloseTo(50 - 50 * DRIFT_RATE_PER_TURN, 9);
  });
  it("applies the 0.01 floor on small gaps and never oscillates", () => {
    expect(driftStep(50, 51)).toBeCloseTo(50.02, 9); // raw step 0.02, above the floor
    expect(driftStep(50, 50.005)).toBe(50.005); // |gap| ≤ 0.01 → snap
  });
  it("a 0.5-point gap closes within 50 turns", () => {
    let value = 50;
    for (let i = 0; i < 50; i++) value = driftStep(value, 50.5);
    expect(value).toBe(50.5);
  });
  it("is idempotent at target", () => {
    expect(driftStep(72.4, 72.4)).toBe(72.4);
  });
});

describe("metricModifierRows (§6)", () => {
  it("returns signed rows summing to the metric's law points, omitting L0", () => {
    const levels = levelsFromBaselines("UK");
    const rows = metricModifierRows("UK", "health.universalCare", levels);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.points > 0 && r.level > 0)).toBe(true);
    const sum = rows.reduce((s, r) => s + r.points, 0);
    expect(sum).toBeCloseTo(lawTargets("UK", levels)["health.universalCare"], 9);
    const primary = rows.find((r) => r.lawId === "uk.health.universalCare.primary")!;
    expect(primary.points).toBe(50);
    expect(primary.levelName).toBe("Universal Comprehensive Service");
  });

  it("sorts rows by contribution descending", () => {
    const levels = levelsFromBaselines("UK");
    const rows = metricModifierRows("UK", "health.universalCare", levels);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].points).toBeGreaterThanOrEqual(rows[i].points);
    }
  });
});

describe("structuralResidual (§4)", () => {
  it("is the exact inverse of composeTarget below the clamp", () => {
    // The property that matters: a board handed this residual composes straight
    // back to the value it was measured from, so a lazy heal moves nothing.
    for (const [value, national, supplement] of [
      [77.2, 57.1, 0],
      [78.9, 57.1, 6.8],
      [40, 10, 100],
    ] as Array<[number, number, number]>) {
      const residual = structuralResidual(value, national, supplement);
      expect(composeTarget(national, supplement, residual)).toBeCloseTo(value, 10);
    }
  });

  it("charges the regional supplement at the same half weight composeTarget pays it", () => {
    // Dropping the supplement here was the old bug: the residual came out
    // 0.5 x supplement too high, so the composed target sat above the value and
    // the board crept upward every turn it was recomputed.
    expect(structuralResidual(80, 57, 6)).toBe(20);
    expect(structuralResidual(80, 57, 0)).toBe(23);
  });

  it("goes negative when the law book already over-explains the score", () => {
    expect(structuralResidual(30, 57, 0)).toBe(-27);
  });
});
