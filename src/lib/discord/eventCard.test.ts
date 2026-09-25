import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  buildDiscordEventCardSvg,
  eventCardInputFromEmbed,
  generateLegacyDiscordEventCard,
} from "./eventCard";
import { saveChartAsPNG } from "@/lib/charts/parliamentChart";

vi.mock("@/lib/charts/parliamentChart", () => ({
  saveChartAsPNG: vi.fn().mockResolvedValue("https://cdn.example.test/card.png"),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

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
    expect(svg).toContain('height="809"');
    expect(svg).toContain('width="730" height="410"');
  });

  it("renders the chamber vote split into the chart slot", () => {
    const svg = buildDiscordEventCardSvg({
      eyebrow: "USA · Federal",
      title: "Labour Right Act",
      summary: "Signed into law",
      metadata: ["Bill enacted", "Economy"],
      voteSplit: [
        { label: "House", votesFor: 232, votesAgainst: 198, votesAbstain: 5, seats: 435 },
        { label: "Senate", votesFor: 62, votesAgainst: 35, votesAbstain: 3, seats: 100 },
      ],
      tone: "positive",
    });

    expect(svg).toContain("data:image/svg+xml;base64,");
    // The chart sits below the chips row rather than at a fixed offset.
    expect(svg).toContain('y="423" width="730" height="410"');
    expect(svg).toContain('height="859"');
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

describe("generateLegacyDiscordEventCard portraits", () => {
  it("resolves relative avatar paths and transcodes WebP to embedded PNG", async () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://ahousedividedgame.com";
    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 200, b: 0 } },
    })
      .webp()
      .toBuffer();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(webp, {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": String(webp.length) },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const url = await generateLegacyDiscordEventCard("US", {
      title: "Supreme Court Nomination",
      description: "A nominee was announced.",
      color: 0x4b2e83,
      thumbnail: { url: "/api/images/npp-politicians/example" },
    });

    expect(url).toBe("https://cdn.example.test/card.png");
    const [svgArg] = vi.mocked(saveChartAsPNG).mock.calls[0];
    expect(svgArg).toContain("OFFICIAL PORTRAIT");
    const dataUrl = svgArg.match(/href="(data:image\/png;base64,[^"]+)"/)?.[1];
    expect(dataUrl).toBeTruthy();
    const png = Buffer.from(dataUrl!.split(",")[1], "base64");
    expect((await sharp(png).metadata()).format).toBe("png");
    // The relative path was resolved against the configured base URL.
    const requested = fetchMock.mock.calls[0][0] as URL;
    expect(requested.hostname).toBe("ahousedividedgame.com");
    expect(requested.pathname).toBe("/api/images/npp-politicians/example");
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
