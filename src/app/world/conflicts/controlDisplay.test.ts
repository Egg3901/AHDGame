import { describe, expect, it } from "vitest";
import { controlSplitDisplay } from "./controlDisplay";

describe("controlSplitDisplay", () => {
  it("rounds control to two decimal places and derives the complementary share", () => {
    expect(controlSplitDisplay(99.6306)).toEqual({ sideA: "0.37", sideB: "99.63" });
    expect(controlSplitDisplay(70)).toEqual({ sideA: "30.00", sideB: "70.00" });
  });

  it("keeps rounded shares at an exact 100.00% total", () => {
    const split = controlSplitDisplay(33.335);

    expect(Number(split.sideA) + Number(split.sideB)).toBe(100);
  });

  it("does not display a pole until control has actually reached it", () => {
    expect(controlSplitDisplay(99.999)).toEqual({ sideA: "0.01", sideB: "99.99" });
    expect(controlSplitDisplay(0.001)).toEqual({ sideA: "99.99", sideB: "0.01" });
    expect(controlSplitDisplay(100)).toEqual({ sideA: "0.00", sideB: "100.00" });
    expect(controlSplitDisplay(0)).toEqual({ sideA: "100.00", sideB: "0.00" });
  });

  it("bounds corrupt out-of-range values to a valid display", () => {
    expect(controlSplitDisplay(120)).toEqual({ sideA: "0.00", sideB: "100.00" });
    expect(controlSplitDisplay(-20)).toEqual({ sideA: "100.00", sideB: "0.00" });
  });
});
