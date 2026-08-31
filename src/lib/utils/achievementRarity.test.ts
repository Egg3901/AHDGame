import { describe, expect, it } from "vitest";

import { getRarityStyle } from "./achievementRarity";

describe("getRarityStyle", () => {
  it("assigns a tier to each band", () => {
    expect(getRarityStyle(0.5).tier).toBe("legendary");
    expect(getRarityStyle(3).tier).toBe("epic");
    expect(getRarityStyle(7).tier).toBe("rare");
    expect(getRarityStyle(20).tier).toBe("uncommon");
    expect(getRarityStyle(60).tier).toBe("common");
  });

  it("treats each band edge as exclusive, so the boundary falls to the tier below", () => {
    // The table tests `rarityPct < max`, so the boundary value itself never
    // reaches the tier it bounds: exactly 1 is Epic, not Legendary.
    expect(getRarityStyle(1).tier).toBe("epic");
    expect(getRarityStyle(5).tier).toBe("rare");
    expect(getRarityStyle(10).tier).toBe("uncommon");
    expect(getRarityStyle(25).tier).toBe("common");
  });

  it("carries the label and border colour with the tier", () => {
    expect(getRarityStyle(0.5)).toMatchObject({ label: "Legendary", borderColor: "#F59E0B" });
    expect(getRarityStyle(60)).toMatchObject({ label: "Common", borderColor: "#6B7280" });
  });

  it("keeps an achievement nobody has ever earned at the top tier", () => {
    expect(getRarityStyle(0).tier).toBe("legendary");
  });

  it("falls back to the last tier rather than returning undefined", () => {
    // The Infinity row is the catch-all, so even a nonsense percentage above
    // 100 still resolves to a real style.
    expect(getRarityStyle(1000).tier).toBe("common");
  });
});
