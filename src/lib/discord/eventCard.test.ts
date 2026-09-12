import { describe, expect, it } from "vitest";
import { buildDiscordEventCardSvg, eventCardInputFromEmbed } from "./eventCard";

describe("buildDiscordEventCardSvg", () => {
  it("renders AHD branding and escapes player-controlled text", () => {
    const svg = buildDiscordEventCardSvg({
      eyebrow: "USA · Federal",
      title: "Jobs & <Growth>",
      summary: "Signed into law",
      metadata: ["Economy"],
      tone: "positive",
    });

    expect(svg).toContain("A HOUSE DIVIDED");
    expect(svg).toContain("Jobs &amp; &lt;Growth&gt;");
    expect(svg).toContain("#4ade80");
    expect(svg).not.toContain("Jobs & <Growth>");
  });

  it("embeds a chart and limits detail rows", () => {
    const svg = buildDiscordEventCardSvg({
      eyebrow: "Election night",
      title: "House results",
      summary: "435 seats decided",
      chartSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      detailLines: ["One", "Two", "Three", "Four", "Five"],
      tone: "election",
    });

    expect(svg).toContain("data:image/svg+xml;base64,");
    expect(svg).toContain(">Four</text>");
    expect(svg).not.toContain(">Five</text>");
    expect(svg).toContain('height="760"');
    expect(svg).toContain('width="730" height="410"');
  });
});

describe("eventCardInputFromEmbed", () => {
  it("turns markdown-heavy legacy embeds into a short card model", () => {
    expect(
      eventCardInputFromEmbed("uk", {
        title: "Government **Formed**",
        description: "**Jane Doe** formed a government.\n\nMore procedural detail follows.",
        color: 0x57f287,
        fields: Array.from({ length: 6 }, (_, index) => ({
          name: `Field ${index + 1}`,
          value: `[Open item](https://example.test/${index})`,
        })),
      })
    ).toEqual({
      eyebrow: "UK · National event",
      title: "Government Formed",
      summary: "Jane Doe formed a government. More procedural detail follows.",
      detailLines: [
        "Field 1 · Open item",
        "Field 2 · Open item",
        "Field 3 · Open item",
        "Field 4 · Open item",
      ],
      tone: "positive",
    });
  });
});
