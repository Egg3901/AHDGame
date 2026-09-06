import { describe, it, expect } from "vitest";
import { opsChannelTotals, describeOpsCurrentEffect } from "./opsCurrentEffect";

type Tree = { starter: boolean; a: number; b: number; c: number };

const locked: Tree = { starter: false, a: 0, b: 0, c: 0 };
const justUnlocked: Tree = { starter: true, a: 0, b: 0, c: 0 };

describe("opsChannelTotals", () => {
  it("reports nothing for a locked lever", () => {
    expect(opsChannelTotals("fundraising", locked)).toEqual({});
  });

  it("credits the starter's own channel once unlocked", () => {
    // Fundraising's starter is +$35k/turn of flat income.
    expect(opsChannelTotals("fundraising", justUnlocked).incomeFlat).toBe(35_000);
    // Ground game's starter is +3% in swing areas.
    expect(opsChannelTotals("groundGame", justUnlocked).swingPct).toBe(3);
    // Media's starter is +0.5%/turn favorability.
    expect(opsChannelTotals("mediaSpending", justUnlocked).favPerTurn).toBe(0.5);
    // Opposition research's starter is -0.5%/turn to the target.
    expect(opsChannelTotals("oppositionResearch", justUnlocked).oppoFavPerTurn).toBe(0.5);
  });

  it("reads a branch tier's magnitude as cumulative, not as a per-tier delta", () => {
    // Grassroots tier 2 is +$700k/turn in total, not 200k + 700k.
    const totals = opsChannelTotals("fundraising", { starter: true, a: 2, b: 0, c: 0 });
    expect(totals.incomeFlat).toBe(35_000 + 700_000);
  });

  it("sums two branches that feed the same channel", () => {
    // Media's Broadcast and Television both feed favPerTurn.
    const totals = opsChannelTotals("mediaSpending", { starter: true, a: 1, b: 1, c: 0 });
    expect(totals.favPerTurn).toBeCloseTo(0.5 + 0.5 + 0.3, 5);
  });

  it("keeps distinct channels apart", () => {
    const totals = opsChannelTotals("groundGame", { starter: true, a: 1, b: 1, c: 0 });
    expect(totals.swingPct).toBe(3 + 4);
    expect(totals.gotvPct).toBe(1.5);
  });

  it("ignores on-purchase lump channels, which are not a standing effect", () => {
    // Bundlers pay out once at purchase; they add nothing per turn.
    const totals = opsChannelTotals("fundraising", { starter: true, a: 0, b: 3, c: 0 });
    expect(totals.incomeFlat).toBe(35_000);
  });

  it("treats an absent tree as locked", () => {
    expect(opsChannelTotals("fundraising", undefined)).toEqual({});
  });
});

describe("describeOpsCurrentEffect", () => {
  it("says a locked lever is locked rather than claiming a zero effect", () => {
    expect(describeOpsCurrentEffect("fundraising", locked, "$")).toBe("Not yet unlocked");
  });

  it("multiplies fundraising income by the Direct Mail multiplier", () => {
    // Starter 35k + Grassroots L1 200k = 235k, then +15% = 270,250.
    const text = describeOpsCurrentEffect("fundraising", { starter: true, a: 1, b: 0, c: 1 }, "$");
    expect(text).toContain("270,250");
    expect(text).toContain("/turn income");
  });

  it("amplifies the opposition drain by Counter-Intel", () => {
    // Starter 0.5 + Dossier L1 0.5 = 1.0, amplified by Counter-Intel L1.
    const text = describeOpsCurrentEffect(
      "oppositionResearch",
      { starter: true, a: 1, b: 0, c: 1 },
      "$"
    );
    expect(text).toMatch(/target fav/i);
    // The drain is reported as a fall, and never as a bare signed number.
    expect(text.startsWith("-")).toBe(true);
  });

  it("reports both ground-game channels when each is invested in", () => {
    const text = describeOpsCurrentEffect("groundGame", { starter: true, a: 1, b: 1, c: 0 }, "$");
    expect(text).toContain("7%");
    expect(text).toContain("1.5%");
  });

  it("reports only the swing channel when turnout is untouched", () => {
    const text = describeOpsCurrentEffect("groundGame", { starter: true, a: 1, b: 0, c: 0 }, "$");
    expect(text).toContain("7%");
    expect(text).not.toContain("everywhere");
  });

  it("sums media favorability across both broadcast branches", () => {
    const text = describeOpsCurrentEffect(
      "mediaSpending",
      { starter: true, a: 1, b: 1, c: 0 },
      "$"
    );
    expect(text).toContain("1.3%");
    expect(text).toMatch(/favorability/i);
  });

  it("uses the campaign's own currency symbol", () => {
    const text = describeOpsCurrentEffect("fundraising", justUnlocked, "£");
    expect(text).toContain("£");
  });

  it("never emits an em or en dash", () => {
    const trees: Tree[] = [
      justUnlocked,
      { starter: true, a: 3, b: 3, c: 3 },
      { starter: true, a: 1, b: 2, c: 0 },
    ];
    for (const cat of [
      "fundraising",
      "oppositionResearch",
      "groundGame",
      "mediaSpending",
    ] as const) {
      for (const t of trees) {
        expect(describeOpsCurrentEffect(cat, t, "$")).not.toMatch(/[–—]/);
      }
    }
  });
});
