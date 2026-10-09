import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ doc: null as Record<string, unknown> | null }));
const accumulate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const primaries = vi.hoisted(() => vi.fn().mockResolvedValue(0));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({ findOne: vi.fn(async () => state.doc) }),
  })),
}));
vi.mock("@/lib/turn/primaryResolution", () => ({
  accumulateGeneralElectionVotes: accumulate,
  recordPrimarySnapshots: primaries,
}));

import { runElectionHalfTick } from "./electionHalfTick";

describe("runElectionHalfTick", () => {
  beforeEach(() => {
    accumulate.mockReset().mockResolvedValue(undefined);
    primaries.mockClear();
  });

  it("banks the early half of the coming turn for live races", async () => {
    state.doc = { currentTurn: 50, isActive: true, isProcessing: false, fastMode: false };
    const now = new Date("2026-10-08T20:30:00Z");
    expect(await runElectionHalfTick(now)).toBe(51);
    expect(accumulate).toHaveBeenCalledWith(now, 51, undefined, { slice: "early" });
    expect(primaries).toHaveBeenCalledWith(now, 51, undefined, { slice: "early" });
  });

  it("still banks primaries when a general race fails, then reports the failure", async () => {
    state.doc = { currentTurn: 50, isActive: true, isProcessing: false, fastMode: false };
    accumulate.mockRejectedValueOnce(new Error("ranked tally lost its revision"));
    await expect(runElectionHalfTick()).rejects.toThrow("ranked tally lost its revision");
    expect(primaries).toHaveBeenCalledOnce();
  });

  it.each([
    ["the world is inactive", { isActive: false }],
    ["a turn holds the lock", { isProcessing: true }],
    ["turns already run every 30 minutes", { fastMode: true }],
  ])("does nothing when %s", async (_label, override) => {
    state.doc = {
      currentTurn: 50,
      isActive: true,
      isProcessing: false,
      fastMode: false,
      ...override,
    };
    expect(await runElectionHalfTick()).toBeNull();
    expect(accumulate).not.toHaveBeenCalled();
    expect(primaries).not.toHaveBeenCalled();
  });
});
