import { describe, it, expect } from "vitest";
import { buildCabinetApprovalModifiers } from "./governmentApproval";
import { applyModifiers } from "./approvalModifiers";

/**
 * The cabinet's drag on national approval (suggestion #315).
 *
 * `US` is presidential (Senate confirmation, so acting appointments exist and
 * cost); `UK` is a parliamentary monarchy, where posts are filled directly by the
 * PM and there is no confirmation gap to charge for.
 */
describe("buildCabinetApprovalModifiers", () => {
  it("charges nothing for a fully confirmed cabinet", () => {
    expect(buildCabinetApprovalModifiers([{}, {}, {}], "US")).toEqual([]);
  });

  it("charges 0.5 per acting secretary", () => {
    const mods = buildCabinetApprovalModifiers([{ acting: true }, {}, {}], "US");
    expect(mods).toHaveLength(1);
    expect(mods[0].id).toBe("cabinet_acting");
    expect(mods[0].effect).toBe(-0.5);
  });

  it("scales linearly and uncapped with the number of acting secretaries", () => {
    const four = buildCabinetApprovalModifiers(
      [{ acting: true }, { acting: true }, { acting: true }, { acting: true }],
      "US"
    );
    expect(four[0].effect).toBe(-2);

    // Deliberately uncapped: a president who never holds a confirmation vote
    // should keep paying, not hit a ceiling and stop caring.
    const twelve = buildCabinetApprovalModifiers(
      Array.from({ length: 12 }, () => ({ acting: true })),
      "US"
    );
    expect(twelve[0].effect).toBe(-6);
  });

  it("singularises the label for one acting secretary", () => {
    expect(buildCabinetApprovalModifiers([{ acting: true }], "US")[0].label).toBe(
      "1 acting secretary"
    );
    expect(buildCabinetApprovalModifiers([{ acting: true }, { acting: true }], "US")[0].label).toBe(
      "2 acting secretaries"
    );
  });

  it("ignores acting flags in a country that has no confirmation step", () => {
    // A parliamentary cabinet is seated by the PM directly. Charging it for an
    // "unconfirmed" appointment would be charging for a vote that never happens.
    expect(buildCabinetApprovalModifiers([{ acting: true }, { acting: true }], "UK")).toEqual([]);
  });

  it("charges the empty-cabinet penalty when nobody is seated", () => {
    const mods = buildCabinetApprovalModifiers([], "US");
    expect(mods).toHaveLength(1);
    expect(mods[0].id).toBe("cabinet_none");
    expect(mods[0].effect).toBe(-7.5);
  });

  it("declares marginEffect 0 so no reader derives a profit-margin swing from it", () => {
    // Readers fall back to `marginEffectForModifier(effect, id)` when marginEffect
    // is absent. A cabinet vacancy is not a corporate-margin event, so the zero is
    // stated rather than left to that fallback.
    for (const mods of [
      buildCabinetApprovalModifiers([], "US"),
      buildCabinetApprovalModifiers([{ acting: true }], "US"),
    ]) {
      expect(mods[0].marginEffect).toBe(0);
    }
  });

  it("subtracts the same amount through applyModifiers as a direct subtraction", () => {
    // The penalties moved from a post-hoc subtraction into the single
    // applyModifiers call. Negatives are uncapped there and 0.5 multiples sit on
    // the tenth-of-a-point grid, so the rating must not shift for anyone.
    const base = 61.3;
    const mods = buildCabinetApprovalModifiers([{ acting: true }, { acting: true }, {}], "US");
    expect(applyModifiers(base, mods)).toBe(60.3);
  });

  it("floors at zero rather than going negative", () => {
    expect(applyModifiers(3, buildCabinetApprovalModifiers([], "US"))).toBe(0);
  });
});
