import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/news", () => ({
  createSystemNewsPost: vi.fn().mockResolvedValue(undefined),
}));

import { createSystemNewsPost } from "@/lib/news";
import { emitCascadeSummaryNews, emitMassCascadeAlert } from "../cascadeNews";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emitCascadeSummaryNews", () => {
  it("posts a sovereign-category news with totals", async () => {
    await emitCascadeSummaryNews("US", {
      levels: 2,
      totalBondsCascaded: 12,
      totalCorpsInsolvent: 3,
      perLevelReports: [],
      insolventCorpIdsByLevel: [],
    });
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("US");
    expect(content).toContain("12");
    expect(content).toContain("3");
    expect(content.toLowerCase()).toContain("cascade");
  });

  it("does not emit when nothing cascaded", async () => {
    await emitCascadeSummaryNews("US", {
      levels: 1,
      totalBondsCascaded: 0,
      totalCorpsInsolvent: 0,
      perLevelReports: [],
      insolventCorpIdsByLevel: [],
    });
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });
});

describe("emitMassCascadeAlert", () => {
  function makeStubDb() {
    const inserted: Array<Record<string, unknown>> = [];
    return {
      inserted,
      db: {
        collection: vi.fn(() => ({
          insertOne: vi.fn(async (doc: Record<string, unknown>) => {
            inserted.push(doc);
            return { acknowledged: true, insertedId: doc._id };
          }),
        })),
      } as never,
    };
  }

  it("emits news + globalAlert when count > MASS_CASCADE_THRESHOLD", async () => {
    const { db, inserted } = makeStubDb();
    await emitMassCascadeAlert(db, "US", 6, 100);
    const [content] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(content.toLowerCase()).toContain("systemic");
    expect(content).toContain("6");
    // Phase 11a: also writes to globalAlerts collection
    expect(inserted).toHaveLength(1);
    expect(inserted[0].kind).toBe("mass-cascade");
    expect(inserted[0].countryCode).toBe("US");
    expect(inserted[0].insolventCorpCount).toBe(6);
    expect(inserted[0].emittedAtTurn).toBe(100);
  });

  it("does not emit anything when count <= threshold", async () => {
    const { db, inserted } = makeStubDb();
    await emitMassCascadeAlert(db, "US", 5, 100);
    expect(createSystemNewsPost).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });
});
