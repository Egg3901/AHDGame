import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { applyPopulistSurgeOnCrisis } from "../applyPopulistSurge";

function makeDb(npps: Array<Record<string, unknown>>) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    db: {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(npps),
        }),
        updateMany: vi.fn(async (filter: Record<string, unknown>, u: Record<string, unknown>) => {
          updates.push({ filter, $inc: u.$inc as Record<string, unknown> });
          return { acknowledged: true, modifiedCount: 1 };
        }),
      })),
    } as never,
  };
}

describe("applyPopulistSurgeOnCrisis", () => {
  it("no-op when no qualifying NPPs", async () => {
    const { db, updates } = makeDb([
      // Centrist — doesn't qualify
      { _id: new ObjectId(), policies: { economic: 0, social: 0 } },
    ]);
    const r = await applyPopulistSurgeOnCrisis(db, "US");
    expect(r.npcsAffected).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("bumps populist NPPs", async () => {
    // populist: extreme economic with non-conservative social
    const populistId = new ObjectId();
    const { db, updates } = makeDb([
      { _id: populistId, policies: { economic: -65, social: 30 } }, // populist per deriveIdeology
    ]);
    const r = await applyPopulistSurgeOnCrisis(db, "US");
    expect(r.npcsAffected).toBe(1);
    expect(updates).toHaveLength(1);
    expect((updates[0].$inc as { favorability: number }).favorability).toBe(10);
    const filter = updates[0].filter as { _id: { $in: ObjectId[] } };
    expect(filter._id.$in.length).toBe(1);
  });

  it("bumps nationalist NPPs (high social = nationalist)", async () => {
    const nationalistId = new ObjectId();
    const { db, updates } = makeDb([
      { _id: nationalistId, policies: { economic: 0, social: 70 } }, // nationalist
    ]);
    const r = await applyPopulistSurgeOnCrisis(db, "UK");
    expect(r.npcsAffected).toBe(1);
    expect(updates).toHaveLength(1);
  });

  it("does not bump non-populist/nationalist NPPs", async () => {
    const { db, updates } = makeDb([
      { _id: new ObjectId(), policies: { economic: 50, social: 50 } }, // conservative
      { _id: new ObjectId(), policies: { economic: -60, social: 0 } }, // socialist (e<-40 + s<20)
      { _id: new ObjectId(), policies: { economic: 50, social: -20 } }, // technocrat
    ]);
    const r = await applyPopulistSurgeOnCrisis(db, "US");
    expect(r.npcsAffected).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("filters multiple — only qualifying get bumped", async () => {
    const { db, updates } = makeDb([
      { _id: new ObjectId(), policies: { economic: -65, social: 30 } }, // populist
      { _id: new ObjectId(), policies: { economic: 0, social: 70 } }, // nationalist
      { _id: new ObjectId(), policies: { economic: 50, social: 50 } }, // conservative
    ]);
    const r = await applyPopulistSurgeOnCrisis(db, "US");
    expect(r.npcsAffected).toBe(2);
    expect(updates).toHaveLength(1);
    const filter = updates[0].filter as { _id: { $in: ObjectId[] } };
    expect(filter._id.$in.length).toBe(2);
  });
});
