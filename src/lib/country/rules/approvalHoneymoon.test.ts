import { describe, it, expect } from "vitest";
import {
  EXPECTATIONS_RAMP_TURNS,
  advanceHeadTenure,
  emptyCabinetSeatsModifier,
  publicExpectationsModifier,
} from "./approvalHoneymoon";

describe("publicExpectationsModifier", () => {
  it("is zero on the turn the head took office", () => {
    const mod = publicExpectationsModifier(100, 100);
    expect(mod.effect).toBe(0);
    expect(mod.id).toBe("public_expectations");
    expect(mod.label).toBe("Higher public expectations (building up, 0 turns in office)");
  });

  it("grows linearly while in the ramp", () => {
    const mid = publicExpectationsModifier(100, 100 + EXPECTATIONS_RAMP_TURNS / 2);
    expect(mid.effect).toBe(-2.5);
    expect(mid.label).toBe("Higher public expectations (building up, 24 turns in office)");
    expect(publicExpectationsModifier(100, 112).label).toContain("12 turns in office");
    expect(publicExpectationsModifier(100, 101).label).toContain("1 turn in office");
    expect(publicExpectationsModifier(100, 112).effect).toBe(-1.3);
  });

  it("reaches the full drag at the end of the ramp and stays there", () => {
    for (const now of [100 + EXPECTATIONS_RAMP_TURNS, 100 + EXPECTATIONS_RAMP_TURNS + 500]) {
      const mod = publicExpectationsModifier(100, now);
      expect(mod.effect).toBe(-5);
      expect(mod.label).toBe("Higher public expectations");
    }
  });

  it("keeps the full drag when the start turn is unknown or in the future", () => {
    expect(publicExpectationsModifier(null, 100).effect).toBe(-5);
    expect(publicExpectationsModifier(undefined, 100).effect).toBe(-5);
    expect(publicExpectationsModifier(Number.NaN, 100).effect).toBe(-5);
    expect(publicExpectationsModifier(200, 100).effect).toBe(-5);
  });

  it("declares marginEffect 0 and a metric source like the fixed modifier did", () => {
    const mod = publicExpectationsModifier(100, 110);
    expect(mod.marginEffect).toBe(0);
    expect(mod.source).toBe("metric");
  });
});

describe("advanceHeadTenure", () => {
  it("records the first head with an unknown start", () => {
    expect(advanceHeadTenure(undefined, "a", 50)).toEqual({ key: "a", sinceTurn: null });
  });

  it("keeps the start turn while the same head stays", () => {
    expect(advanceHeadTenure({ key: "a", sinceTurn: 10 }, "a", 50)).toEqual({
      key: "a",
      sinceTurn: 10,
    });
    expect(advanceHeadTenure({ key: "a", sinceTurn: null }, "a", 50)).toEqual({
      key: "a",
      sinceTurn: null,
    });
  });

  it("starts the clock when the head changes", () => {
    expect(advanceHeadTenure({ key: "a", sinceTurn: 10 }, "b", 50)).toEqual({
      key: "b",
      sinceTurn: 50,
    });
    expect(advanceHeadTenure({ key: "a", sinceTurn: null }, "b", 50).sinceTurn).toBe(50);
  });

  it("starts the clock for a new head after a vacancy", () => {
    const vacant = advanceHeadTenure({ key: "a", sinceTurn: 10 }, null, 40);
    expect(vacant).toEqual({ key: null, sinceTurn: null });
    expect(advanceHeadTenure(vacant, "b", 50)).toEqual({ key: "b", sinceTurn: 50 });
  });
});

describe("emptyCabinetSeatsModifier", () => {
  it("charges the full 7.5 when no seat is filled", () => {
    const mod = emptyCabinetSeatsModifier(0, 8);
    expect(mod?.effect).toBe(-7.5);
    expect(mod?.id).toBe("cabinet_none");
    expect(mod?.marginEffect).toBe(0);
  });

  it("charges nothing for a full cabinet", () => {
    expect(emptyCabinetSeatsModifier(8, 8)).toBeNull();
  });

  it("scales with the share of empty seats", () => {
    const mod = emptyCabinetSeatsModifier(5, 8);
    expect(mod?.effect).toBe(-2.8);
    expect(mod?.label).toBe("Empty cabinet seats (3 of 8)");
    expect(emptyCabinetSeatsModifier(4, 8)?.effect).toBe(-3.8);
    expect(emptyCabinetSeatsModifier(7, 8)?.label).toBe("Empty cabinet seats (1 of 8)");
  });

  it("never reports more seated than seats", () => {
    expect(emptyCabinetSeatsModifier(12, 8)).toBeNull();
  });

  it("falls back to the binary rule when the seat total is unknown", () => {
    expect(emptyCabinetSeatsModifier(0, undefined)?.effect).toBe(-7.5);
    expect(emptyCabinetSeatsModifier(3, undefined)).toBeNull();
    expect(emptyCabinetSeatsModifier(0, 0)?.effect).toBe(-7.5);
    expect(emptyCabinetSeatsModifier(2, 0)).toBeNull();
  });
});
