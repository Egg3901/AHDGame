import { describe, it, expect } from "vitest";
import { plantsCorpGuideContent } from "./plantsCorpGuide";
import {
  CAPACITY_BUILD_TURNS,
  IDLE_UPKEEP_FRACTION,
  MOTHBALL_UPKEEP_FRACTION,
  CAPACITY_BUILD_CANCEL_REFUND,
} from "@/lib/constants/capacityEconomy";
import {
  DOMINANCE_MARKET_SHARE_THRESHOLD,
  DOMINANCE_NATIONAL_SHARE_THRESHOLD,
} from "@/lib/constants/corporations";
import { economyPages } from "../pages/economy";

describe("plants-corp-guide wiki content", () => {
  it("is dash-free player copy", () => {
    expect(plantsCorpGuideContent).not.toMatch(/[—–]/);
  });

  it("carries no internal jargon", () => {
    expect(plantsCorpGuideContent).not.toMatch(/PR #|ticket|re-anchor/i);
  });

  it("quotes the live constants, so a retune reflows into the page", () => {
    expect(plantsCorpGuideContent).toContain(
      `${Math.round(IDLE_UPKEEP_FRACTION * 100)}% of the maintenance`
    );
    expect(plantsCorpGuideContent).toContain(
      `${Math.round(MOTHBALL_UPKEEP_FRACTION * 100)}% of full running maintenance`
    );
    expect(plantsCorpGuideContent).toContain(
      `refunds ${Math.round(CAPACITY_BUILD_CANCEL_REFUND * 100)}%`
    );
    expect(plantsCorpGuideContent).toContain(`${DOMINANCE_MARKET_SHARE_THRESHOLD}% share`);
    expect(plantsCorpGuideContent).toContain(
      `${DOMINANCE_NATIONAL_SHARE_THRESHOLD}% of the national`
    );
    // Build-time table includes the slowest (energy) and fastest (retail) rows.
    expect(plantsCorpGuideContent).toContain(`| ${CAPACITY_BUILD_TURNS("energy")} |`);
    expect(plantsCorpGuideContent).toContain(`| ${CAPACITY_BUILD_TURNS("retail")} |`);
  });

  it("references only screenshots that exist in the repo", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const refs = [
      ...plantsCorpGuideContent.matchAll(/\]\((\/static\/wiki\/plants-corp-guide\/[^)]+)\)/g),
    ].map((m) => m[1]);
    expect(refs.length).toBeGreaterThanOrEqual(6);
    for (const ref of refs) {
      const file = path.join(process.cwd(), "public", ref);
      expect(fs.existsSync(file), `missing screenshot ${ref}`).toBe(true);
    }
  });

  it("is registered as a seeded economy page under the plants-corp-guide slug", () => {
    const page = economyPages.find((p) => p.slug === "plants-corp-guide");
    expect(page).toBeDefined();
    expect(page?.category).toBe("economy");
    expect(page?.content).toBe(plantsCorpGuideContent);
  });
});
