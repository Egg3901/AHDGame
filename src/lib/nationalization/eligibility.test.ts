import { describe, it, expect } from "vitest";
import { evaluateEligibility, type EligibilityInput } from "./eligibility";
import { DISTRESS_VACANT_CEO_TURNS, FINANCIAL_DISTRESS_GRACE_TURNS } from "./constants";

const base: EligibilityInput = {
  ownerKind: "player",
  liquidCapital: 1_000_000,
  hasDefaultedBond: false,
  ceoVacantTurns: 0,
  currentTurn: 5000,
  strategicSectorMatch: false,
  topMarketSharePercent: 10,
  supermajorityVotePassed: false,
  financialDistressTurns: 0,
};

describe("evaluateEligibility", () => {
  it("NPC corps are always eligible with the npc trigger", () => {
    const r = evaluateEligibility({ ...base, ownerKind: "npc" });
    expect(r.eligible).toBe(true);
    expect(r.triggers).toContain("npc");
  });

  it("unowned assets are always eligible", () => {
    const r = evaluateEligibility({ ...base, ownerKind: "unowned" });
    expect(r.eligible).toBe(true);
    expect(r.triggers).toContain("unowned");
  });

  it("a healthy player corp is not eligible", () => {
    const r = evaluateEligibility(base);
    expect(r.eligible).toBe(false);
    expect(r.triggers).toEqual([]);
  });

  it("insolvency fires distress only once it has persisted the grace window", () => {
    const before = evaluateEligibility({
      ...base,
      liquidCapital: -1,
      financialDistressTurns: FINANCIAL_DISTRESS_GRACE_TURNS - 1,
    });
    expect(before.isDistressed).toBe(false);
    expect(before.triggers).not.toContain("distress");

    const after = evaluateEligibility({
      ...base,
      liquidCapital: -1,
      financialDistressTurns: FINANCIAL_DISTRESS_GRACE_TURNS,
    });
    expect(after.eligible).toBe(true);
    expect(after.triggers).toContain("distress");
  });

  it("a defaulted bond fires distress only after the grace window", () => {
    const before = evaluateEligibility({
      ...base,
      hasDefaultedBond: true,
      financialDistressTurns: FINANCIAL_DISTRESS_GRACE_TURNS - 1,
    });
    expect(before.triggers).not.toContain("distress");

    const after = evaluateEligibility({
      ...base,
      hasDefaultedBond: true,
      financialDistressTurns: FINANCIAL_DISTRESS_GRACE_TURNS,
    });
    expect(after.triggers).toContain("distress");
  });

  it("a long-vacant CEO fires distress at its own threshold, with no financial grace needed", () => {
    const r = evaluateEligibility({
      ...base,
      ceoVacantTurns: DISTRESS_VACANT_CEO_TURNS,
      financialDistressTurns: 0,
    });
    expect(r.triggers).toContain("distress");
    expect(r.isDistressed).toBe(true);
  });

  it("a short CEO vacancy does NOT fire distress", () => {
    const r = evaluateEligibility({ ...base, ceoVacantTurns: DISTRESS_VACANT_CEO_TURNS - 1 });
    expect(r.triggers).not.toContain("distress");
  });

  it("a solvent corp below the monopoly line is not monopoly-eligible", () => {
    const r = evaluateEligibility({ ...base, topMarketSharePercent: 74 });
    expect(r.triggers).not.toContain("monopoly");
  });

  it("crossing the 75% monopoly line fires the monopoly trigger", () => {
    const r = evaluateEligibility({ ...base, topMarketSharePercent: 75 });
    expect(r.triggers).toContain("monopoly");
  });

  it("strategic-sector match fires the strategic trigger", () => {
    const r = evaluateEligibility({ ...base, strategicSectorMatch: true });
    expect(r.triggers).toContain("strategic");
  });

  it("a passed supermajority vote fires the supermajority trigger", () => {
    const r = evaluateEligibility({ ...base, supermajorityVotePassed: true });
    expect(r.triggers).toContain("supermajority");
  });

  it("isDistressed is true only for matured unambiguous-failure triggers", () => {
    expect(
      evaluateEligibility({
        ...base,
        liquidCapital: -1,
        financialDistressTurns: FINANCIAL_DISTRESS_GRACE_TURNS,
      }).isDistressed
    ).toBe(true);
    expect(evaluateEligibility({ ...base, topMarketSharePercent: 90 }).isDistressed).toBe(false);
  });
});
