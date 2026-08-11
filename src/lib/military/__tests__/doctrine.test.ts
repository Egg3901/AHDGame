import { describe, it, expect } from "vitest";
import { nationalDoctrineEffects, missingSynergy } from "../doctrine";

describe("doctrine effects", () => {
  it("surfaces the active national doctrine effects", () => {
    const fx = nationalDoctrineEffects();
    expect(fx.length).toBeGreaterThan(0);
    expect(fx[0]).toHaveProperty("val");
    expect(fx[0]).toHaveProperty("label");
  });

  it("names a missing synergy suggestion", () => {
    expect(missingSynergy()).toMatch(/Unified Theater Commands/);
  });
});
