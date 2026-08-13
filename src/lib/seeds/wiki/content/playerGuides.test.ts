import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { economyPages } from "../pages/economy";
import { electionsPages } from "../pages/elections";
import { logisticsGuideContent } from "./logisticsGuide";
import { electionsPlayerGuideContent } from "./electionsPlayerGuide";
import { privateBankingContent } from "./privateBanking";
import { commoditiesContent } from "./commodities";

const guideContent = [
  logisticsGuideContent,
  electionsPlayerGuideContent,
  privateBankingContent,
  commoditiesContent,
].join("\n");

describe("ticket 1066 player wiki guides", () => {
  it("registers the banking, logistics, and visual elections guides", () => {
    expect(economyPages.find((page) => page.slug === "private-banking")?.content).toBe(
      privateBankingContent
    );
    expect(economyPages.find((page) => page.slug === "logistics-guide")?.content).toBe(
      logisticsGuideContent
    );
    expect(electionsPages.find((page) => page.slug === "elections-player-guide")?.content).toBe(
      electionsPlayerGuideContent
    );
  });

  it("keeps the new player copy free of dash glyphs", () => {
    expect(logisticsGuideContent).not.toMatch(/[—–]/);
    expect(electionsPlayerGuideContent).not.toMatch(/[—–]/);
  });

  it("answers how NPI grows, is spent, and is refunded", () => {
    expect(electionsPlayerGuideContent).toContain("min(100, local political influence) / 100");
    expect(electionsPlayerGuideContent).toContain("| 3 | 30 total |");
    expect(electionsPlayerGuideContent).toContain("refunds the recorded proposal NPI cost");
  });

  it("references only screenshots checked into the public tree", () => {
    const refs = [...guideContent.matchAll(/\]\((\/static\/wiki\/player-guides\/[^)]+)\)/g)].map(
      (match) => match[1]
    );
    expect(new Set(refs).size).toBeGreaterThanOrEqual(4);
    for (const ref of refs) {
      expect(fs.existsSync(path.join(process.cwd(), "public", ref)), ref).toBe(true);
    }
  });
});
