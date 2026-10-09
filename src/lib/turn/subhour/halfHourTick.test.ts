import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const { calls, election, growth, inflation, forex, market } = vi.hoisted(() => {
  const calls: string[] = [];
  const step = (name: string) =>
    vi.fn(async () => {
      calls.push(name);
      return { ok: name };
    });
  return {
    calls,
    election: vi.fn(async () => {
      calls.push("election");
      return 57;
    }),
    growth: step("growth"),
    inflation: step("inflation"),
    forex: step("forex"),
    market: vi.fn(async () => {
      calls.push("market");
      return { turn: 56 };
    }),
  };
});
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/turn/elections/electionHalfTick", () => ({ runElectionHalfTick: election }));
vi.mock("./growthHalfStep", () => ({ runGrowthHalfStep: growth }));
vi.mock("./inflationHalfStep", () => ({ runInflationHalfStep: inflation }));
vi.mock("./forexHalfStep", () => ({ runForexHalfStep: forex }));
vi.mock("./marketTick", () => ({ runMarketTick: market }));

import { runHalfHourTick } from "./halfHourTick";

const dbWith = (state: Record<string, unknown> | null) =>
  ({ collection: () => ({ findOne: vi.fn().mockResolvedValue(state) }) }) as unknown as Db;

describe("runHalfHourTick", () => {
  const now = new Date("2026-10-09T20:30:00Z");
  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("runs elections, growth, inflation, exchange rates, then markets, for the coming turn", async () => {
    const db = dbWith({ currentTurn: 56, isActive: true, isProcessing: false });
    const result = await runHalfHourTick(now, db);
    expect(calls).toEqual(["election", "growth", "inflation", "forex", "market"]);
    expect(growth).toHaveBeenCalledWith(db, 57, now);
    expect(result).toMatchObject({ turn: 57, electionTurn: 57, market: { turn: 56 } });
  });

  it("still refreshes macro and markets when election accumulation fails", async () => {
    election.mockRejectedValueOnce(new Error("tally revision conflict"));
    const result = await runHalfHourTick(now, dbWith({ currentTurn: 56, isActive: true }));
    expect(result?.electionTurn).toBeNull();
    expect(result?.steps.elections).toEqual({ error: "tally revision conflict" });
    expect(calls).toEqual(["growth", "inflation", "forex", "market"]);
  });

  it("keeps going when one macro step fails; the turn absorbs it", async () => {
    inflation.mockRejectedValueOnce(new Error("boom"));
    const result = await runHalfHourTick(now, dbWith({ currentTurn: 56, isActive: true }));
    expect(result?.steps.inflation).toEqual({ error: "boom" });
    expect(calls).toEqual(["election", "growth", "forex", "market"]);
  });

  it.each([
    ["inactive", { currentTurn: 56, isActive: false }],
    ["turn running", { currentTurn: 56, isActive: true, isProcessing: true }],
    ["fast mode", { currentTurn: 56, isActive: true, fastMode: true }],
  ])("does nothing when %s", async (_label, state) => {
    expect(await runHalfHourTick(now, dbWith(state))).toBeNull();
    expect(calls).toEqual([]);
  });
});
