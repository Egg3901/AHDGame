import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

const { resolveConflict } = vi.hoisted(() => ({
  resolveConflict: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock("@/lib/military/resolveConflict", () => ({ resolveConflict }));

import { resolvePeaceWindows } from "./peaceWindows";

function mockDb(opts: {
  conflictsEnabled?: boolean;
  lapsed?: Array<Record<string, unknown>>;
  claimModified?: number;
}) {
  const updates: Array<{ filter: unknown; update: unknown }> = [];
  const db = {
    collection: (name: string) => ({
      findOne: async () =>
        name === "gameState" ? { conflictsEnabled: opts.conflictsEnabled !== false } : null,
      find: () => ({ toArray: async () => opts.lapsed ?? [] }),
      updateOne: async (filter: unknown, update: unknown) => {
        updates.push({ filter, update });
        return { modifiedCount: opts.claimModified ?? 1 };
      },
    }),
  } as unknown as Db;
  return { db, updates };
}

const lapsedWar = {
  _id: "w1",
  termsWindow: { victor: "B", imposer: "UK", target: "TR", closesTurn: 100 },
};

beforeEach(() => resolveConflict.mockClear());

describe("resolvePeaceWindows", () => {
  it("does nothing while the conflicts subsystem is off", async () => {
    const { db } = mockDb({ conflictsEnabled: false, lapsed: [lapsedWar] });
    expect(await resolvePeaceWindows(db, 100)).toEqual({ resolved: 0 });
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("white-peaces a lapsed window for the side that won the ground", async () => {
    const { db } = mockDb({ lapsed: [lapsedWar] });
    expect(await resolvePeaceWindows(db, 100)).toEqual({ resolved: 1 });
    expect(resolveConflict).toHaveBeenCalledWith(expect.anything(), lapsedWar, "B", 100);
  });

  it("claims on status, so two overlapping turn runs resolve it once", async () => {
    // The find and the writes are not atomic, and this project has had overlapping
    // turn runs from a rolling deploy.
    const { db, updates } = mockDb({ lapsed: [lapsedWar] });
    await resolvePeaceWindows(db, 100);
    expect(updates[0]!.filter).toMatchObject({ _id: "w1", status: "terms_pending" });
  });

  it("does nothing when another runner claimed it first", async () => {
    const { db } = mockDb({ lapsed: [lapsedWar], claimModified: 0 });
    expect(await resolvePeaceWindows(db, 100)).toEqual({ resolved: 0 });
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("stamps no settlement, because no term was taken", async () => {
    const { db, updates } = mockDb({ lapsed: [lapsedWar] });
    await resolvePeaceWindows(db, 100);
    expect(JSON.stringify(updates)).not.toContain("settlement");
  });

  it("skips a window with no victor rather than picking one", async () => {
    const { db } = mockDb({
      lapsed: [{ _id: "w2", termsWindow: { imposer: "UK", target: "TR", closesTurn: 100 } }],
    });
    expect(await resolvePeaceWindows(db, 100)).toEqual({ resolved: 0 });
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("resolves nothing when no window has lapsed", async () => {
    const { db } = mockDb({ lapsed: [] });
    expect(await resolvePeaceWindows(db, 100)).toEqual({ resolved: 0 });
  });
});
