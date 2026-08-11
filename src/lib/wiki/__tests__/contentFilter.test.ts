import { describe, expect, it } from "vitest";
import { screenWikiContent } from "../contentFilter";

describe("screenWikiContent", () => {
  const baseInput = {
    title: "Harmless title",
    description: "A perfectly normal summary of an in-game event.",
    content:
      "This page describes the legislative history of the 2024 reform package, the parties that backed it, and the eventual outcome on the floor.",
  };

  it("accepts ordinary prose", () => {
    expect(screenWikiContent(baseInput)).toEqual({ ok: true });
  });

  it("rejects slurs in the content", () => {
    const result = screenWikiContent({ ...baseInput, content: `${baseInput.content} n1gger` });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/community rules/i);
  });

  it("rejects slurs in the title", () => {
    const result = screenWikiContent({ ...baseInput, title: "F4ggot brigade" });
    expect(result.ok).toBe(false);
  });

  it("rejects obvious product spam", () => {
    const result = screenWikiContent({
      ...baseInput,
      content: `${baseInput.content} buy viagra online cheap`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/spam/i);
  });

  it("rejects link-stuffed bodies", () => {
    const links = Array(40)
      .fill(0)
      .map((_, i) => `[link${i}](https://example.com/${i})`)
      .join(" ");
    const result = screenWikiContent({ ...baseInput, content: `short intro. ${links}` });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/links/i);
  });

  it("rejects mostly-uppercase walls of text", () => {
    const content = "A".repeat(400);
    const result = screenWikiContent({ ...baseInput, content });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/capital/i);
  });

  it("is case-insensitive for slurs", () => {
    const result = screenWikiContent({ ...baseInput, content: `${baseInput.content} NIGGER` });
    expect(result.ok).toBe(false);
  });

  it("does not flag benign substrings that overlap blocklist words", () => {
    // Scunthorpe problem — 'nigg' is a substring but we use word boundaries.
    const result = screenWikiContent({
      ...baseInput,
      content: `${baseInput.content} Scunthorpe United played well this season.`,
    });
    expect(result.ok).toBe(true);
  });
});
