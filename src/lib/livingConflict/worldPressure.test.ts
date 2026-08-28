import { describe, expect, it } from "vitest";
import type { ActiveWarSnapshot } from "./worldPressure";
import { vietnamWorldPressure } from "./worldPressure";

function war(overrides: Partial<ActiveWarSnapshot> = {}): ActiveWarSnapshot {
  return {
    status: "active",
    intensity: 70,
    hostCountry: "DD",
    hostEntities: ["DD", "DE"],
    sideA: { countries: ["US"] },
    sideB: { countries: ["DD", "RU"] },
    ...overrides,
  };
}

describe("Vietnam world pressure", () => {
  it("adds no pressure without an active opposed superpower war", () => {
    expect(vietnamWorldPressure(100, [])).toBe(0);
    expect(vietnamWorldPressure(100, [war({ status: "resolved" })])).toBe(0);
    expect(vietnamWorldPressure(100, [war({ intensity: 49 })])).toBe(0);
    expect(vietnamWorldPressure(100, [war({ sideB: { countries: ["DD"] } })])).toBe(0);
  });

  it("requires elevated global tension", () => {
    expect(vietnamWorldPressure(74, [war()])).toBe(0);
    expect(vietnamWorldPressure(75, [war()])).toBe(2);
  });

  it("makes a brink-level Germany war the strongest spillover case", () => {
    expect(vietnamWorldPressure(90, [war()])).toBe(4);
    expect(vietnamWorldPressure(90, [war({ hostCountry: "FR", hostEntities: ["FR"] })])).toBe(3);
  });
});
