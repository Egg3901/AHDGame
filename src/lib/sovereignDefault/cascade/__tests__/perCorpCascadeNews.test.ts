import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/news", () => ({
  createSystemNewsPost: vi.fn().mockResolvedValue(undefined),
}));

import { createSystemNewsPost } from "@/lib/news";
import { emitPerCorpCascadeNews } from "../perCorpCascadeNews";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emitPerCorpCascadeNews", () => {
  it("posts a sovereign-category news with country, level, corp name + type", async () => {
    await emitPerCorpCascadeNews({
      countryCode: "US",
      level: 1,
      corpId: new ObjectId(),
      corpName: "Aurora Industries",
      corpType: "manufacturing",
      corpCountryId: "JP",
    });
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("Aurora Industries");
    expect(content).toContain("manufacturing");
    expect(content).toContain("JP");
    expect(content).toContain("US");
    expect(content.toLowerCase()).toContain("cascade");
    expect(content).toMatch(/level\s*1/i);
  });
});
