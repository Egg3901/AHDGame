import { describe, it, expect } from "vitest";
import { levelToTree } from "./2026-08-18-campaign-ops-trees";

describe("levelToTree — legacy level → branch tree", () => {
  it("leaves level 0 un-started", () => {
    expect(levelToTree(0)).toEqual({ starter: false, a: 0, b: 0, c: 0 });
  });

  it("unlocks the starter at level 1 with no branch investment", () => {
    expect(levelToTree(1)).toEqual({ starter: true, a: 0, b: 0, c: 0 });
  });

  it("fills branch a first, then b, then c", () => {
    expect(levelToTree(2)).toEqual({ starter: true, a: 1, b: 0, c: 0 });
    expect(levelToTree(4)).toEqual({ starter: true, a: 3, b: 0, c: 0 });
    expect(levelToTree(5)).toEqual({ starter: true, a: 3, b: 1, c: 0 });
  });

  it("fully maxes the tree at the old fundraising cap (L10)", () => {
    expect(levelToTree(10)).toEqual({ starter: true, a: 3, b: 3, c: 3 });
  });

  it("never exceeds branch caps for over-large levels", () => {
    expect(levelToTree(99)).toEqual({ starter: true, a: 3, b: 3, c: 3 });
  });
});
