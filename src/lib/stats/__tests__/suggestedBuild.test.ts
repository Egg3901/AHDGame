import { describe, it, expect } from "vitest";
import { suggestStatBuild } from "../suggestedBuild";
import { validateStatAllocation } from "../validateStatAllocation";
import { STAT_KEYS } from "../statsConstants";

function maxStat(stats: Record<string, number>): string {
  return STAT_KEYS.reduce((best, k) => (stats[k] > stats[best] ? k : best), STAT_KEYS[0]);
}

describe("suggestStatBuild", () => {
  it("always returns a build that passes validateStatAllocation", () => {
    const inputs = [
      {},
      { isCeo: true, corpsOwned: 5 },
      { favorability: 100, politicalInfluence: 100 },
      { donorBaseLevel: 75, campaignFunds: 5_000_000 },
      { hasOffice: true, isLeader: true, careerLength: 40, pollsRun: 30 },
    ];
    for (const input of inputs) {
      const build = suggestStatBuild(input);
      expect(validateStatAllocation(build).ok).toBe(true);
    }
  });

  it("returns a legal build for empty/zero input", () => {
    const build = suggestStatBuild({});
    const result = validateStatAllocation(build);
    expect(result.ok).toBe(true);
  });

  it("weights businessAcumen highest for a CEO with many corps", () => {
    const build = suggestStatBuild({ isCeo: true, corpsOwned: 8 });
    expect(maxStat(build)).toBe("businessAcumen");
  });

  it("weights charisma highest for a high-favorability, high-influence character", () => {
    const build = suggestStatBuild({ favorability: 100, politicalInfluence: 100 });
    expect(maxStat(build)).toBe("charisma");
  });

  it("weights fundraising highest for a deep donor base", () => {
    const build = suggestStatBuild({ donorBaseLevel: 75, campaignFunds: 10_000_000 });
    expect(maxStat(build)).toBe("fundraising");
  });
});
