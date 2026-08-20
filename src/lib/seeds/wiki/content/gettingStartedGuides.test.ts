import { describe, expect, it } from "vitest";
import { gettingStartedContent } from "./gettingStarted";
import { createACharacterContent } from "./createACharacter";
import { theGameLoopContent } from "./theGameLoop";
import { playerProgressionContent } from "./playerProgression";
import { firstCampaignWalkthroughContent } from "./firstCampaignWalkthrough";
import { tipsForBeginnersContent } from "./tipsForBeginners";
import { gettingStartedPages } from "../pages/gettingStarted";

const guides = [
  ["getting-started", gettingStartedContent],
  ["create-a-character", createACharacterContent],
  ["the-game-loop", theGameLoopContent],
  ["player-progression", playerProgressionContent],
  ["first-campaign-walkthrough", firstCampaignWalkthroughContent],
  ["tips-for-beginners", tipsForBeginnersContent],
] as const;

describe("getting-started task guides", () => {
  it("keeps player copy free of em and en dashes", () => {
    for (const [slug, body] of guides) {
      expect(body, slug).not.toMatch(/[—–]/);
    }
  });

  it("is task-first: each guide says what to click and includes a first-week checklist", () => {
    for (const [slug, body] of guides) {
      expect(body, slug).toMatch(/## Your first week/i);
      expect(body, slug).toMatch(/- \[ \]/);
      expect(body, slug).toMatch(/click|open \*\*|log in/i);
    }
  });

  it("embeds screenshot slots that hide when the PNG is absent", () => {
    const withSlots = guides.filter(([slug]) => slug !== "create-a-character");
    for (const [slug, body] of withSlots) {
      expect(body, slug).toContain("```guide-screenshot");
    }
  });

  it("does not rewrite reference pages in the getting-started category", () => {
    const referenceSlugs = gettingStartedPages
      .filter((p) => p.contentType === "reference")
      .map((p) => p.slug);
    expect(referenceSlugs).toEqual(
      expect.arrayContaining(["core-systems", "stats-actions", "relocation", "game-starting-state"])
    );
  });
});
