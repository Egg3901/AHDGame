import { describe, expect, it } from "vitest";
import { leanFill, leanLabel, pathCentre, pinRadius, valueFill } from "./fieldOfficeMapMath";

describe("fieldOfficeMapMath", () => {
  it("labels lean by side, with an even band", () => {
    expect(leanLabel(0.2)).toBe("Even");
    expect(leanLabel(8.14)).toBe("Right +8.1");
    expect(leanLabel(-30.3)).toBe("Left +30.3");
  });
  it("shades left and right apart and saturates", () => {
    expect(leanFill(-20)).not.toBe(leanFill(20));
    expect(leanFill(30)).toBe(leanFill(90));
    expect(leanFill(0)).toBe(leanFill(0.3));
  });
  it("shades value relative to the best spot", () => {
    expect(valueFill(0, 1)).toBe(valueFill(-1, 1));
    expect(valueFill(1, 1)).not.toBe(valueFill(0.2, 1));
    expect(valueFill(1, 0)).toBe(valueFill(0, 0));
  });
  it("centres a polygon path on its bounding box", () => {
    expect(pathCentre("M0,0L10,0L10,4L0,4Z")).toEqual({ x: 5, y: 2 });
    expect(pathCentre("")).toBeNull();
  });
  it("scales pins to the viewBox", () => {
    expect(pinRadius("0 0 100 50")).toBeCloseTo(1.2);
  });
});
