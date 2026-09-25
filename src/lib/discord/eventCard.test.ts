import { describe, expect, it } from "vitest";
import {
  buildDiscordEventCardSvg,
  buildLegislatureVoteChartSvg,
  eventCardInputFromEmbed,
} from "./eventCard";

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

  it("renders a prominent official portrait without exposing a remote URL", () => {
    const svg = buildDiscordEventCardSvg({
      eyebrow: "USA · Election result",
      title: "President-elect Jane Doe",
      summary: "Won 312 electoral votes",
      portraitDataUrl: "data:image/png;base64,cG9ydHJhaXQ=",
      tone: "election",
    });

    expect(svg).toContain("OFFICIAL PORTRAIT");
    expect(svg).toContain('width="266" height="300"');
    expect(svg).toContain("data:image/png;base64,cG9ydHJhaXQ=");
    expect(svg).toContain('<clipPath id="copyClip"><rect x="60" y="100" width="730"');
  });

  it("pairs a legislature vote chart with a representative event image", () => {
    const chartSvg = buildLegislatureVoteChartSvg({ for: 280, against: 140, abstain: 15 });
    const svg = buildDiscordEventCardSvg({
      eyebrow: "USA · Legislature",
      title: "Clean Air Act",
      summary: "Signed into law",
      chartSvg,
      portraitDataUrl: "data:image/jpeg;base64,Y2FwaXRvbA==",
      portraitLabel: "UNITED STATES CAPITOL",
    });

    expect(svg).toContain("UNITED STATES CAPITOL");
    expect(chartSvg).toContain(">AYE · 280</text>");
    expect(chartSvg).toContain(">NO · 140</text>");
    expect(chartSvg).toContain(">ABSTAIN · 15</text>");
    expect(svg).toContain("data:image/jpeg;base64,Y2FwaXRvbA==");
  });

  it("wraps long portrait titles before the photo column", () => {
    const svg = buildDiscordEventCardSvg({
      eyebrow: "US · National event",
      title: "[TEST PREVIEW] Central Bank Appointment",
      summary: "Eleanor Hart has been confirmed as central bank chair.",
      portraitDataUrl: "data:image/png;base64,cG9ydHJhaXQ=",
    });

    expect(svg).toContain(">[TEST PREVIEW]</text>");
    expect(svg).toContain(">Central Bank</text>");
    expect(svg).toContain(">Appointment</text>");
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

  it("turns US legislative webhook tallies into charts and marks the Capitol art", () => {
    const input = eventCardInputFromEmbed("US", {
      title: "Federal bill enacted: Clean Air Act",
      description: "Signed into law.",
      color: 0x57f287,
      fields: [{ name: "Floor Vote", value: "For 280, Against 140, Abstain 15" }],
    });

    expect(input.eyebrow).toBe("US · Legislature");
    expect(input.portraitLabel).toBe("UNITED STATES CAPITOL");
    expect(input.chartSvg).toContain("AYE · 280");
  });
});
