import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getConfidenceGauge,
  applyConfidenceEventToGov,
  tickConfidenceForGov,
  resetConfidenceGauge,
  getConfidenceGaugeHistory,
  isConfidenceDissolutionEnabled,
  tickParliamentaryGovernmentConfidence,
} from "@/lib/countries/uk/confidence/confidenceGaugeStore";
import { CONFIDENCE_START, CONFIDENCE_HITS } from "@/lib/countries/uk/confidence/confidenceGauge";

const OLD = process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION;
afterEach(() => {
  if (OLD === undefined) delete process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION;
  else process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION = OLD;
});

function fakeDb(initial?: number) {
  const doc: {
    confidenceGauge?: number;
    confidenceGaugeHistory?: Array<{
      turn: number | null;
      value: number;
      at: Date;
      reason: string;
    }>;
    currentTurn?: number;
  } = {};
  if (initial !== undefined) doc.confidenceGauge = initial;
  const updateOne = vi.fn(
    async (
      _f: unknown,
      update: {
        $set: Record<string, unknown>;
        $push?: {
          confidenceGaugeHistory: {
            $each: NonNullable<typeof doc.confidenceGaugeHistory>[number][];
            $slice: number;
          };
        };
      }
    ) => {
      Object.assign(doc, update.$set);
      if (update.$push) {
        doc.confidenceGaugeHistory = [
          ...(doc.confidenceGaugeHistory ?? []),
          ...update.$push.confidenceGaugeHistory.$each,
        ].slice(update.$push.confidenceGaugeHistory.$slice);
      }
    }
  );
  const findOne = vi.fn(async () => doc);
  return { db: { collection: () => ({ findOne, updateOne }) } as never, doc, updateOne };
}

describe("getConfidenceGauge", () => {
  it("defaults to full when unset", async () => {
    const { db } = fakeDb();
    expect(await getConfidenceGauge(db)).toBe(CONFIDENCE_START);
  });
  it("reads the stored value", async () => {
    const { db } = fakeDb(42);
    expect(await getConfidenceGauge(db)).toBe(42);
  });
});

describe("applyConfidenceEventToGov", () => {
  it("applies the hit and persists", async () => {
    const { db, doc } = fakeDb(CONFIDENCE_START);
    const r = await applyConfidenceEventToGov(db, { kind: "budgetDefeat" }, new Date());
    expect(r.value).toBe(CONFIDENCE_START - CONFIDENCE_HITS.budgetDefeat);
    expect(doc.confidenceGauge).toBe(r.value);
  });

  it("reports dissolutionDue but keeps auto-dissolve gated off by default", async () => {
    delete process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION;
    const { db } = fakeDb(5);
    const r = await applyConfidenceEventToGov(db, { kind: "budgetDefeat" }, new Date());
    expect(r.value).toBe(0);
    expect(r.dissolutionDue).toBe(true);
    expect(r.dissolutionEnabled).toBe(false); // gated
  });

  it("enables dissolution only with the flag", async () => {
    process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION = "1";
    const { db } = fakeDb(5);
    const r = await applyConfidenceEventToGov(db, { kind: "budgetDefeat" }, new Date());
    expect(r.dissolutionEnabled).toBe(true);
    expect(isConfidenceDissolutionEnabled()).toBe(true);
  });
});

describe("tickConfidenceForGov", () => {
  it("recovers with high approval and persists", async () => {
    const { db, doc } = fakeDb(50);
    const r = await tickConfidenceForGov(db, { approval: 100, now: new Date() });
    expect(r.value).toBeGreaterThan(50);
    expect(doc.confidenceGauge).toBe(r.value);
  });

  it("passes the approval erosion scale through to the pure gauge", async () => {
    const { db, doc } = fakeDb(50);
    const r = await tickConfidenceForGov(db, {
      approval: 0,
      erosionScale: 0,
      now: new Date(),
    });
    expect(r.value).toBe(50);
    expect(doc.confidenceGauge).toBe(50);
  });
});

describe("resetConfidenceGauge", () => {
  it("carries the prior value forward with a modest formation boost", async () => {
    const { db, doc } = fakeDb(10);
    doc.currentTurn = 81;
    const formedAt = new Date("1994-01-01T00:00:00.000Z");
    await resetConfidenceGauge(db, formedAt, 81);
    expect(doc.confidenceGauge).toBe(19);
    expect(doc.confidenceGaugeHistory).toEqual([
      { turn: 81, value: 19, at: formedAt, reason: "governmentFormed" },
    ]);
  });

  it("preserves strong predecessor confidence without resetting below full", async () => {
    const { db, doc } = fakeDb(CONFIDENCE_START - 1);
    expect(await resetConfidenceGauge(db, new Date(), 82)).toBeLessThan(CONFIDENCE_START);
    expect(doc.confidenceGauge).toBeLessThan(CONFIDENCE_START);
  });

  it("retains a bounded chronological history", async () => {
    const { db } = fakeDb(50);
    for (let turn = 1; turn <= 510; turn += 1) {
      await tickConfidenceForGov(db, { approval: 50, now: new Date(turn), turn });
    }
    const history = await getConfidenceGaugeHistory(db);
    expect(history).toHaveLength(500);
    expect(history[0]?.turn).toBe(11);
    expect(history.at(-1)?.turn).toBe(510);
  });
});

describe("tickParliamentaryGovernmentConfidence", () => {
  it("updates each country's formed government and appends a bounded history point in one batch", async () => {
    const bulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const governments = [
      {
        _id: "IE",
        countryId: "IE",
        status: "formed",
        confidenceGauge: 50,
        confidenceGaugeHistory: [],
        formedTurn: 1,
      },
    ];
    const approvals = [{ _id: "IE", approvalRating: 0 }];
    const db = {
      collection(name: string) {
        if (name === "governmentFormations") {
          return {
            find: () => ({ toArray: async () => governments }),
            bulkWrite,
          };
        }
        if (name === "governmentApprovals") {
          return { find: () => ({ toArray: async () => approvals }) };
        }
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as never;

    const now = new Date("1994-01-01T00:00:00.000Z");
    const updates = await tickParliamentaryGovernmentConfidence(db, {
      countryIds: ["IE"],
      now,
      turn: 40,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.countryId).toBe("IE");
    expect(updates[0]?.value).toBeLessThan(50);
    expect(bulkWrite).toHaveBeenCalledOnce();
    const [operations] = bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: Record<string, unknown> } } }>,
    ];
    expect(operations[0]?.updateOne.update.$set.confidenceGaugeHistory).toEqual([
      { turn: 40, value: updates[0]?.value, at: now, reason: "turn" },
    ]);
  });
});
