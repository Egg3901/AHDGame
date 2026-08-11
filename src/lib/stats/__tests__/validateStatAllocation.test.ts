import { describe, it, expect } from "vitest";
import { validateStatAllocation } from "../validateStatAllocation";

const valid = {
  charisma: 5,
  debate: 4,
  energy: 4,
  fundraising: 4,
  businessAcumen: 4,
  statecraft: 4,
  intellect: 3,
}; // sum = 28

describe("validateStatAllocation", () => {
  it("accepts a legal 28-point integer spread", () => {
    const result = validateStatAllocation(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stats).toEqual(valid);
  });

  it("rejects a sum that is not 28", () => {
    expect(validateStatAllocation({ ...valid, intellect: 2 }).ok).toBe(false); // sum 27
    expect(validateStatAllocation({ ...valid, intellect: 4 }).ok).toBe(false); // sum 29
  });

  it("rejects any stat below the floor", () => {
    expect(validateStatAllocation({ ...valid, charisma: 0, debate: 9 }).ok).toBe(false);
  });

  it("rejects any stat above the cap", () => {
    expect(validateStatAllocation({ ...valid, charisma: 11, intellect: -3 }).ok).toBe(false);
  });

  it("rejects non-integer values", () => {
    expect(validateStatAllocation({ ...valid, charisma: 5.5, debate: 3.5 }).ok).toBe(false);
  });

  it("rejects a missing key", () => {
    const { intellect, ...partial } = valid;
    void intellect;
    expect(validateStatAllocation(partial).ok).toBe(false);
  });

  it("rejects an extra key", () => {
    expect(validateStatAllocation({ ...valid, charisma: 4, bogus: 1 }).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateStatAllocation(null).ok).toBe(false);
    expect(validateStatAllocation("nope").ok).toBe(false);
  });
});
