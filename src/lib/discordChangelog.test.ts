import { describe, it, expect } from "vitest";
import { loadPublicPost, loadPublicPosts } from "@/lib/changelog/posts";
import {
  buildEmbedsForChangelogPost,
  formatChangelogTextForDiscord,
  isPreConsolidationRelease,
} from "@/lib/discordChangelog";
import type { ChangelogPost } from "@/lib/changelog/types";

function embedCharCount(embed: { title?: string; description?: string }): number {
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0);
}

describe("formatChangelogTextForDiscord", () => {
  it("expands wiki and site-relative markdown links", () => {
    const text =
      "See [Demographics](/wiki/demographics) and the [changelog](/changelog) for details.";
    const formatted = formatChangelogTextForDiscord(text);
    expect(formatted).toContain("[Demographics](https://wiki.");
    expect(formatted).toContain("/demographics)");
    expect(formatted).toContain("[changelog](https://");
    expect(formatted).toContain("/changelog)");
  });

  it("leaves absolute links unchanged", () => {
    const text = "Visit [Discord](https://discord.com/invite/example).";
    expect(formatChangelogTextForDiscord(text)).toBe(text);
  });
});

describe("buildEmbedsForChangelogPost", () => {
  const samplePost: ChangelogPost = {
    slug: "0.4.0",
    version: "0.4.0",
    date: "2026-07-04",
    title: "Wages, Maps & the Living Electorate",
    summary: "Layer-1 demographics and corporate tech trees go live.",
    tags: ["mechanics"],
    badges: ["major"],
    body: `0.4.0 is a structural release.

## What you'll notice

- **[States have real political texture.](/wiki/demographics)** Census-derived voter archetypes.

## Platform

- **Wire transfers capped at ₳50M per 24 hours** across currencies.`,
  };

  it("builds a header embed plus section embeds with canonical styling", () => {
    const embeds = buildEmbedsForChangelogPost(samplePost, false);
    expect(embeds.length).toBeGreaterThanOrEqual(3);
    expect(embeds[0].title).toContain("v0.4.0");
    expect(embeds[0].description).toContain("Wages, Maps & the Living Electorate");
    expect(embeds.some((e) => e.title?.startsWith("✨ Highlights"))).toBe(true);
    expect(embeds.some((e) => e.title?.startsWith("🔧 Platform"))).toBe(true);
  });

  it("converts relative wiki links inside bullet embeds", () => {
    const embeds = buildEmbedsForChangelogPost(samplePost, false);
    const highlights = embeds.find(
      (e) => e.title?.includes("Highlights") && e.description?.includes("States")
    );
    expect(highlights?.description).toContain("https://wiki.");
    expect(highlights?.description).not.toContain("](/wiki/");
  });

  it("stays within Discord per-embed and per-message limits for v0.4.0", () => {
    const post = loadPublicPost("0.4.0");
    expect(post).not.toBeNull();
    const embeds = buildEmbedsForChangelogPost(post!, false);

    expect(embeds.length).toBeLessThanOrEqual(10);
    for (const embed of embeds) {
      expect(embed.description?.length ?? 0).toBeLessThanOrEqual(4096);
      expect(embed.title?.length ?? 0).toBeLessThanOrEqual(256);
    }

    const totalChars = embeds.reduce((sum, embed) => sum + embedCharCount(embed), 0);
    expect(totalChars).toBeLessThanOrEqual(6000);
  });

  it("filters update embeds to new items only", () => {
    const embeds = buildEmbedsForChangelogPost(
      samplePost,
      true,
      new Set(["**Wire transfers capped at ₳50M per 24 hours** across currencies."])
    );
    const platform = embeds.find((e) => e.title?.includes("Platform"));
    expect(platform?.description).toContain("Wire transfers");
    expect(platform?.description).not.toContain("States have real political texture");
  });
});

// The consolidation rewrote every public post and created four version keys
// changelogSentHistory has never seen. Announcing them would send four full
// releases to Discord and an in-game notification to every player for each.
describe("isPreConsolidationRelease", () => {
  it("silences every release that shipped under the old numbering", () => {
    for (const version of [
      "0.4.0",
      "1.0.0",
      "1.1.0",
      "1.2.0",
      "1.3.0",
      "1.4.0",
      "1.5.0",
      "1.6.0",
    ]) {
      expect(isPreConsolidationRelease(version)).toBe(true);
    }
  });

  it("announces everything cut after it", () => {
    for (const version of ["1.6.1", "1.7.0", "1.10.0", "2.0.0"]) {
      expect(isPreConsolidationRelease(version)).toBe(false);
    }
  });

  it("keeps historic public posts silent and the current release eligible", () => {
    const shipped = loadPublicPosts().map((p) => p.version);
    expect(shipped.length).toBeGreaterThan(0);
    expect(shipped.filter(isPreConsolidationRelease)).toEqual([
      "1.6.0",
      "1.5.0",
      "1.4.0",
      "1.3.0",
      "1.2.0",
      "1.1.0",
      "1.0.0",
      "0.4.2",
      "0.4.1",
      "0.4.0",
    ]);
    expect(shipped.filter((version) => !isPreConsolidationRelease(version))).toEqual([
      "1.7.1",
      "1.7.0",
    ]);
  });
});
