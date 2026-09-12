import { describe, expect, it } from "vitest";
import { buildDiscordEventCardSvg } from "./eventCard";

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
