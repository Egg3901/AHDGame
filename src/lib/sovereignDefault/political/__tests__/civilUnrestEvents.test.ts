import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/news", () => ({
  createSystemNewsPost: vi.fn().mockResolvedValue(undefined),
}));

import { emitCivilUnrestEvents } from "../civilUnrestEvents";
import { createSystemNewsPost } from "@/lib/news";

/**
 * The trust hit lands on the political BOARD now (via applyLegacyTrustDelta),
 * which read-modify-writes whole `values` objects rather than $inc'ing a legacy
 * path — so the fixture supplies a board doc and captures the bulkWrite.
 */
function makeDb(boardValue = 60) {
  const writes: Array<Record<string, Record<string, number>>> = [];
  return {
    writes,
    db: {
      collection: vi.fn(() => ({
        find: vi.fn(() => ({
          toArray: vi.fn(async () => [
            {
              _id: "R1",
              countryId: "US",
              values: { "governance.integrity": boardValue },
              residuals: { "governance.integrity": 0 },
            },
          ]),
        })),
        bulkWrite: vi.fn(async (ops: Array<{ updateOne: { update: { $set: never } } }>) => {
          for (const op of ops) writes.push(op.updateOne.update.$set);
          return { acknowledged: true };
        }),
        updateMany: vi.fn(async () => ({ acknowledged: true, modifiedCount: 0 })),
      })),
    } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emitCivilUnrestEvents", () => {
  it("repudiate emits 3 events", async () => {
    const { db } = makeDb();
    const r = await emitCivilUnrestEvents(db, "US", "repudiate");
    expect(r.eventsEmitted).toBe(3);
    expect(createSystemNewsPost).toHaveBeenCalledTimes(3);
  });

  it("monetize emits 2 events", async () => {
    const { db } = makeDb();
    const r = await emitCivilUnrestEvents(db, "US", "monetize");
    expect(r.eventsEmitted).toBe(2);
    expect(createSystemNewsPost).toHaveBeenCalledTimes(2);
  });

  it("restructure emits 1 event", async () => {
    const { db } = makeDb();
    const r = await emitCivilUnrestEvents(db, "US", "restructure");
    expect(r.eventsEmitted).toBe(1);
    expect(createSystemNewsPost).toHaveBeenCalledTimes(1);
  });

  it("bailout emits 1 event", async () => {
    const { db } = makeDb();
    const r = await emitCivilUnrestEvents(db, "US", "bailout");
    expect(r.eventsEmitted).toBe(1);
  });

  it("applies the publicTrust hit to the board, scaled by event count", async () => {
    const { db, writes } = makeDb(60);
    await emitCivilUnrestEvents(db, "US", "repudiate");
    expect(writes).toHaveLength(1);
    // 3 events x 2 trust each = -6 legacy points, converted onto the board's
    // 0-100 scale, so the family drops but not by a raw 6.
    const next = writes[0].values["governance.integrity"];
    expect(next).toBeLessThan(60);
  });

  it("scales with the number of events", async () => {
    const many = makeDb(60);
    await emitCivilUnrestEvents(many.db, "US", "repudiate"); // 3 events
    const few = makeDb(60);
    await emitCivilUnrestEvents(few.db, "US", "restructure"); // 1 event
    expect(many.writes[0].values["governance.integrity"]).toBeLessThan(
      few.writes[0].values["governance.integrity"]
    );
  });

  it("each emitted news article tags the country and 'sovereign' category", async () => {
    const { db } = makeDb();
    await emitCivilUnrestEvents(db, "JP", "repudiate");
    const calls = vi.mocked(createSystemNewsPost).mock.calls;
    for (const [content, category] of calls) {
      expect(content).toContain("JP");
      expect(content.toLowerCase()).toContain("civil unrest");
      expect(category).toBe("sovereign");
    }
  });

  it("deterministic with injected rng — picks the same templates", async () => {
    const { db: db1 } = makeDb();
    const { db: db2 } = makeDb();
    let i1 = 0;
    let i2 = 0;
    const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const rng1 = () => seq[i1++ % seq.length];
    const rng2 = () => seq[i2++ % seq.length];
    await emitCivilUnrestEvents(db1, "US", "repudiate", rng1);
    const calls1 = vi.mocked(createSystemNewsPost).mock.calls.map((c) => c[0]);
    vi.mocked(createSystemNewsPost).mockClear();
    await emitCivilUnrestEvents(db2, "US", "repudiate", rng2);
    const calls2 = vi.mocked(createSystemNewsPost).mock.calls.map((c) => c[0]);
    expect(calls1).toEqual(calls2);
  });
});
