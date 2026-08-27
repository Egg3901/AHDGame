import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

// vi.mock factories are hoisted above module-scope consts, so the spies have to
// be created inside vi.hoisted or they are still in the temporal dead zone when
// the factory runs.
const { triggerSnapElection, updateCountryState } = vi.hoisted(() => ({
  triggerSnapElection: vi.fn(async () => ({ electionsSpawned: 3 }) as never),
  updateCountryState: vi.fn(async () => ({}) as never),
}));

vi.mock("@/lib/turn/snapElection", () => ({
  triggerSnapElection,
  SnapElectionError: class SnapElectionError extends Error {},
}));
vi.mock("@/lib/countryState", () => ({ updateCountryState }));

import { processPostConversionElections } from "./postConversionElections";

function dbWith(rows: Array<Record<string, unknown>>) {
  const find = vi.fn(() => ({ toArray: async () => rows }));
  const db = { collection: vi.fn(() => ({ find })) } as unknown as Db;
  return { db, find };
}

const now = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  triggerSnapElection.mockClear();
  triggerSnapElection.mockResolvedValue({ electionsSpawned: 3 } as never);
  updateCountryState.mockClear();
});

describe("processPostConversionElections", () => {
  it("does nothing when no country carries a marker", async () => {
    const { db } = dbWith([]);
    expect(await processPostConversionElections(db, 100, now)).toEqual({ fired: 0 });
    expect(triggerSnapElection).not.toHaveBeenCalled();
  });

  it("only queries markers whose turn has arrived", async () => {
    // The turn filter is in the query, not in a loop guard: a world with many
    // converted countries must not read every one of them every tick.
    const { db, find } = dbWith([]);
    await processPostConversionElections(db, 100, now);
    expect(find).toHaveBeenCalledWith({
      "pendingPostConversionElection.atTurn": { $lte: 100 },
    });
  });

  it("fires a regime-change snap for a due marker", async () => {
    const { db } = dbWith([{ _id: "DD", pendingPostConversionElection: { atTurn: 100 } }]);
    expect(await processPostConversionElections(db, 100, now)).toEqual({ fired: 1 });
    expect(triggerSnapElection).toHaveBeenCalledWith(expect.anything(), "DD", now, {
      reason: "regime-change",
      bypassLimits: true,
    });
  });

  it("clears the marker so it cannot fire twice", async () => {
    const { db } = dbWith([{ _id: "DD", pendingPostConversionElection: { atTurn: 100 } }]);
    await processPostConversionElections(db, 100, now);
    expect(updateCountryState).toHaveBeenCalledWith(expect.anything(), "DD", {
      pendingPostConversionElection: undefined,
    });
  });

  it("clears the marker even when the snap throws, so a turn cannot loop on it", async () => {
    // A country with no governmentFormation row makes triggerSnapElection throw.
    // Leaving the marker in place would retry it every turn forever, and a
    // country that cannot snap will not start being able to.
    triggerSnapElection.mockRejectedValueOnce(new Error("No government formation record"));
    const { db } = dbWith([{ _id: "DD", pendingPostConversionElection: { atTurn: 100 } }]);
    const result = await processPostConversionElections(db, 100, now);
    expect(result).toEqual({ fired: 0 });
    expect(updateCountryState).toHaveBeenCalledWith(expect.anything(), "DD", {
      pendingPostConversionElection: undefined,
    });
  });

  it("keeps going when one country's snap throws", async () => {
    triggerSnapElection.mockRejectedValueOnce(new Error("boom"));
    const { db } = dbWith([
      { _id: "DD", pendingPostConversionElection: { atTurn: 100 } },
      { _id: "RU", pendingPostConversionElection: { atTurn: 100 } },
    ]);
    expect(await processPostConversionElections(db, 100, now)).toEqual({ fired: 1 });
    expect(updateCountryState).toHaveBeenCalledTimes(2);
  });

  it("never throws, because a turn must not fail on one country's marker", async () => {
    triggerSnapElection.mockRejectedValueOnce(new Error("boom"));
    const { db } = dbWith([{ _id: "DD", pendingPostConversionElection: { atTurn: 100 } }]);
    await expect(processPostConversionElections(db, 100, now)).resolves.toBeTruthy();
  });
});
