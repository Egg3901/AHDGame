import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getConfidenceGauge,
  applyConfidenceEventToGov,
  tickConfidenceForGov,
  resetConfidenceGauge,
  isConfidenceDissolutionEnabled,
} from "./confidenceGaugeStore";
import { CONFIDENCE_START, CONFIDENCE_HITS } from "./confidenceGauge";

const OLD = process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION;
afterEach(() => {
  if (OLD === undefined) delete process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION;
  else process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION = OLD;
});

function fakeDb(initial?: number) {
  const doc: { confidenceGauge?: number } = {};
  if (initial !== undefined) doc.confidenceGauge = initial;
  const updateOne = vi.fn(async (_f: unknown, update: { $set: Record<string, unknown> }) => {
    Object.assign(doc, update.$set);
  });
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
});

describe("resetConfidenceGauge", () => {
  it("restores to full", async () => {
    const { db, doc } = fakeDb(10);
    await resetConfidenceGauge(db, new Date());
    expect(doc.confidenceGauge).toBe(CONFIDENCE_START);
  });
});
