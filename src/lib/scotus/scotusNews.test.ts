import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { DocketCase } from "@/lib/db/types/scotus";
import { SURPRISE_CASE_TEMPLATES } from "./surpriseCaseTemplates";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendNewsEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { scotusRuling: 0x4b2e83 },
}));

function makeCase(overrides: Partial<DocketCase> = {}): DocketCase {
  const now = new Date();
  return {
    _id: new ObjectId(),
    countryId: "US",
    preset: "1953-default",
    caseKey: "test-case",
    title: "Test v. Case",
    axis: "social",
    historicalMajorityDirection: -1,
    decisionYear: 1962,
    status: "decided",
    historicalSummary: "History happened this way.",
    alternateSummary: "History diverged this way.",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildDocketCaseNews", () => {
  it("uses historicalSummary and an affirming headline when the outcome affirms history", async () => {
    const { buildDocketCaseNews } = await import("./scotusNews");
    const docketCase = makeCase();
    const { title, body } = buildDocketCaseNews(docketCase, {
      outcome: "affirmed",
      positiveCount: 2,
      negativeCount: 6,
      neutralCount: 0,
    });

    expect(title).toContain("Test v. Case");
    expect(title).toContain("Historical Ruling Holds");
    expect(body).toContain("History happened this way.");
    expect(body).not.toContain("History diverged this way.");
    expect(body).toContain("2-6");
    expect(body).toContain("social axis");
  });

  it("uses alternateSummary and a diverging headline when the outcome diverges", async () => {
    const { buildDocketCaseNews } = await import("./scotusNews");
    const docketCase = makeCase({ axis: "economic" });
    const { title, body } = buildDocketCaseNews(docketCase, {
      outcome: "diverged",
      positiveCount: 5,
      negativeCount: 3,
      neutralCount: 1,
    });

    expect(title).toContain("Court Breaks From History");
    expect(body).toContain("History diverged this way.");
    expect(body).not.toContain("History happened this way.");
    expect(body).toContain("5-3");
    expect(body).toContain("1 justice recorded no lean");
    expect(body).toContain("economic axis");
  });

  it("falls back to generic copy when no summary was authored, instead of throwing", async () => {
    const { buildDocketCaseNews } = await import("./scotusNews");
    const docketCase = makeCase({ historicalSummary: undefined, alternateSummary: undefined });
    const { body } = buildDocketCaseNews(docketCase, {
      outcome: "affirmed",
      positiveCount: 1,
      negativeCount: 0,
      neutralCount: 0,
    });
    expect(body).toContain("affirmed the historical outcome");
  });
});

describe("buildSurpriseCaseNews", () => {
  const template = SURPRISE_CASE_TEMPLATES[0];

  it("labels the right-leaning bloc when majoritySide is 1", async () => {
    const { buildSurpriseCaseNews } = await import("./scotusNews");
    const { title, body } = buildSurpriseCaseNews(template, {
      positiveCount: 3,
      negativeCount: 1,
      neutralCount: 0,
      majoritySide: 1,
    });
    expect(title).toContain(template.title);
    expect(body).toContain("right-leaning bloc");
    expect(body).toContain("3-1");
  });

  it("labels the left-leaning bloc when majoritySide is -1", async () => {
    const { buildSurpriseCaseNews } = await import("./scotusNews");
    const { body } = buildSurpriseCaseNews(template, {
      positiveCount: 1,
      negativeCount: 3,
      neutralCount: 0,
      majoritySide: -1,
    });
    expect(body).toContain("left-leaning bloc");
  });

  it("reports no ruling on a headcount tie instead of fabricating a winning side", async () => {
    const { buildSurpriseCaseNews } = await import("./scotusNews");
    const { body } = buildSurpriseCaseNews(template, {
      positiveCount: 2,
      negativeCount: 2,
      neutralCount: 0,
      majoritySide: 0,
    });
    expect(body).toContain("no controlling majority");
    expect(body).toContain("no ruling and no policy change");
  });
});

describe("generateScotusRulingNews / generateScotusSurpriseNews", () => {
  it("posts to the in-app feed (category judicial) and pushes to the Discord news webhook", async () => {
    const { generateScotusRulingNews } = await import("./scotusNews");
    const { createSystemNewsPost } = await import("@/lib/news");
    const { sendNewsEvent } = await import("@/lib/discordWebhooks");

    const docketCase = makeCase();
    await generateScotusRulingNews(docketCase, {
      outcome: "affirmed",
      positiveCount: 4,
      negativeCount: 2,
      neutralCount: 0,
    });

    expect(createSystemNewsPost).toHaveBeenCalledWith(
      expect.stringContaining("History happened this way."),
      "judicial",
      expect.objectContaining({ title: expect.stringContaining("Test v. Case") })
    );
    expect(sendNewsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Test v. Case"),
        color: 0x4b2e83,
      })
    );
  });

  it("posts a surprise-case ruling under the same judicial category", async () => {
    const { generateScotusSurpriseNews } = await import("./scotusNews");
    const { createSystemNewsPost } = await import("@/lib/news");

    await generateScotusSurpriseNews(SURPRISE_CASE_TEMPLATES[1], {
      positiveCount: 2,
      negativeCount: 1,
      neutralCount: 0,
      majoritySide: 1,
    });

    expect(createSystemNewsPost).toHaveBeenCalledWith(
      expect.any(String),
      "judicial",
      expect.objectContaining({ title: expect.stringContaining(SURPRISE_CASE_TEMPLATES[1].title) })
    );
  });
});

describe("buildScotusVacancyNews", () => {
  it("names the departing justice and the vacant seat", async () => {
    const { buildScotusVacancyNews } = await import("./scotusNews");
    const { title, body } = buildScotusVacancyNews({
      seatNumber: 1,
      justiceName: "Lyndon B. Johnson",
    });
    expect(title).toBe("SCOTUS Seat #1 Vacant");
    expect(body).toContain("Lyndon B. Johnson has left the Supreme Court");
    expect(body).toContain("Seat #1 is now vacant");
  });

  it("says the justice died in office when the hazard clock fired", async () => {
    const { buildScotusVacancyNews } = await import("./scotusNews");
    const { body } = buildScotusVacancyNews({
      seatNumber: 1,
      justiceName: "Lyndon B. Johnson",
      cause: "death",
    });
    expect(body).toContain("Lyndon B. Johnson has died in office");
    expect(body).not.toContain("has left the Supreme Court");
  });

  it("falls back to generic copy when the seat has no justice name", async () => {
    const { buildScotusVacancyNews } = await import("./scotusNews");
    const { body } = buildScotusVacancyNews({ seatNumber: 6, justiceName: null });
    expect(body).toContain("A justice has left the Supreme Court");
    expect(body).toContain("Seat #6");
  });
});
