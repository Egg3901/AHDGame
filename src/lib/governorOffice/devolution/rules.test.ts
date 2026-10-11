import { describe, expect, it } from "vitest";
import {
  computeIndependenceDesireDriftSnapshot as step,
  regionalApprovalDrift,
  nationalApprovalDrift,
} from "./rules";

const neutral = {
  policy: "pro" as const,
  regionalApproval: 50,
  nationalApproval: 50,
  inflationPercent: 3,
};

describe("independence desire precision and trajectories", () => {
  it.each([10, 60])("preserves 48 turns of baseline recovery from %s", (start) => {
    let previous = start;
    for (let turn = 0; turn < 48; turn++) {
      const result = step({ ...neutral, previous });
      expect(result.delta).toBeCloseTo(start < 25 ? 0.003 : -0.003, 6);
      previous = result.next;
    }
    expect(previous).toBeCloseTo(start + (start < 25 ? 0.144 : -0.144), 6);
  });

  it.each([24.999, 25.001])("settles at 25 without oscillating from %s", (previous) => {
    const first = step({ ...neutral, previous });
    expect(first.next).toBe(25);
    expect(first.delta).toBeCloseTo(25 - previous, 6);
    expect(step({ ...neutral, previous: first.next }).delta).toBe(0);
  });

  it("preserves fractional Westminster approval and sub-hundredth net movement", () => {
    const result = step({ ...neutral, previous: 60, nationalApproval: 49.9 });
    expect(result.drivers.nationalApproval).toBeCloseTo(0.0002, 6);
    expect(result.next).toBe(59.9972);
    expect(result.delta).toBe(-0.0028);
  });

  it.each([0, 10, 25, 75, 90, 100])("caps approval contributions at %s approval", (approval) => {
    expect(Math.abs(regionalApprovalDrift(approval, "independence"))).toBeLessThanOrEqual(0.05);
    expect(Math.abs(nationalApprovalDrift(approval))).toBeLessThanOrEqual(0.05);
  });

  it("changes direction when a separatist government loses its mandate", () => {
    const popular = step({
      ...neutral,
      previous: 60,
      policy: "independence",
      regionalApproval: 70,
    });
    const rejected = step({
      ...neutral,
      previous: 60,
      policy: "independence",
      regionalApproval: 25,
    });
    expect(popular.delta).toBe(0.087);
    expect(rejected.delta).toBe(-0.003);
  });

  it("gains 3 to 5 points per year for a popular separatist government", () => {
    let previous = 35;
    for (let turn = 0; turn < 48; turn++) {
      previous = step({ ...neutral, previous, policy: "independence", regionalApproval: 70 }).next;
    }
    expect(previous - 35).toBeCloseTo(4.176, 6);
  });

  it.each([0, 0.001, 25, 60, 99.999, 100])(
    "keeps stored movement consistent with bounds from %s",
    (start) => {
      for (const policy of ["anti", "pro", "independence"] as const) {
        for (const regionalApproval of [0, 50, 100]) {
          for (const nationalApproval of [0, 50, 100]) {
            let previous = start;
            for (let turn = 0; turn < 480; turn++) {
              const result = step({
                previous,
                policy,
                regionalApproval,
                nationalApproval,
                inflationPercent: 6,
              });
              expect(result.next).toBeGreaterThanOrEqual(0);
              expect(result.next).toBeLessThanOrEqual(100);
              expect(result.delta).toBeCloseTo(result.next - previous, 6);
              previous = result.next;
            }
          }
        }
      }
    }
  );

  it("reports zero movement while pinned at a bound", () => {
    expect(
      step({
        ...neutral,
        previous: 100,
        policy: "independence",
        regionalApproval: 100,
        nationalApproval: 0,
        inflationPercent: 6,
      }).delta
    ).toBe(0);
    expect(
      step({
        ...neutral,
        previous: 0,
        policy: "anti",
        regionalApproval: 100,
        nationalApproval: 100,
        inflationPercent: 1,
      }).delta
    ).toBe(0);
  });
});
