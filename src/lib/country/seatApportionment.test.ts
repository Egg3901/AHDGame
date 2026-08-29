import { describe, it, expect } from "vitest";
import { apportionSeats } from "./seatApportionment";

describe("apportionSeats", () => {
  it("rescales the Volkskammer's 500 seats onto the eastern Bundestag's 48", () => {
    const out = apportionSeats({ "7": 281, "8": 59, "9": 50, "10": 55, "11": 55 }, 48);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(48);
    expect(out["7"]).toBeGreaterThan(out["8"]);
  });

  it("always returns exactly the target total", () => {
    for (const total of [1, 7, 12, 48, 500]) {
      const out = apportionSeats({ a: 3, b: 3, c: 1 }, total);
      expect(Object.values(out).reduce((x, y) => x + y, 0)).toBe(total);
    }
  });

  it("gives a sub-quota party zero rather than rounding it up", () => {
    const out = apportionSeats({ big: 999, tiny: 1 }, 2);
    expect(out.tiny).toBe(0);
    expect(out.big).toBe(2);
  });

  it("breaks remainder ties by ascending key so re-runs match", () => {
    const a = apportionSeats({ "2": 1, "1": 1, "3": 1 }, 4);
    const b = apportionSeats({ "3": 1, "1": 1, "2": 1 }, 4);
    expect(a).toEqual(b);
    expect(a["1"]).toBe(2);
  });

  it("returns an empty allocation for an empty source", () => {
    expect(apportionSeats({}, 48)).toEqual({});
  });

  it("returns all zeroes when the source holds no seats", () => {
    expect(apportionSeats({ a: 0, b: 0 }, 10)).toEqual({ a: 0, b: 0 });
  });

  it("returns all zeroes for a non-positive target", () => {
    expect(apportionSeats({ a: 5, b: 5 }, 0)).toEqual({ a: 0, b: 0 });
  });

  it("ignores a negative source count rather than subtracting seats", () => {
    const out = apportionSeats({ a: 10, b: -5 }, 4);
    expect(out.a).toBe(4);
    expect(out.b).toBe(0);
  });
});
