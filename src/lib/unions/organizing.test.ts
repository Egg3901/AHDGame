import { describe, expect, it } from "vitest";
import { organizingBand, organizingValue } from "./organizing";

describe("organizingBand", () => {
  it("calls low approval Hostile", () => {
    expect(organizingBand(0).label).toBe("Hostile");
    expect(organizingBand(19.9).label).toBe("Hostile");
  });

  it("crosses into Discontent, Neutral and Content at each 20-point band", () => {
    expect(organizingBand(20).label).toBe("Discontent");
    expect(organizingBand(40).label).toBe("Neutral");
    expect(organizingBand(60).label).toBe("Content");
  });

  it("reads BASE_APPROVAL (55, a union that charges and gives nothing) as Content, not disliked", () => {
    expect(organizingBand(55).label).toBe("Content");
  });

  it("tops out at Loyal", () => {
    expect(organizingBand(100).label).toBe("Loyal");
  });

  it("covers the whole range with no gaps", () => {
    for (let a = 0; a <= 100; a += 0.5) {
      expect(organizingBand(a).label).toBeTruthy();
    }
  });

  it("treats a non-finite score as zero rather than throwing", () => {
    expect(organizingBand(Number.NaN).label).toBe("Hostile");
    expect(organizingValue(Number.NaN)).toBe("0.0 / 100");
  });
});

describe("organizingValue", () => {
  it("prints the score out of 100", () => {
    expect(organizingValue(16.5)).toBe("16.5 / 100");
  });
});
