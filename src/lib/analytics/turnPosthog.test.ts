import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const sdk = vi.hoisted(() => ({
  capture: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  construct: vi.fn(),
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(key: string, options: unknown) {
      sdk.construct(key, options);
    }
    capture = sdk.capture;
    flush = sdk.flush;
  },
}));

function fakeDb(): Db {
  const rows: Record<string, unknown[]> = {
    federalBudget: [
      { countryId: "US", treasuryBalance: 1000, economicFactors: { inflationRate: 2.5 } },
    ],
    countryHistory: [{ eventType: "bill_enacted", countryId: "US" }],
    elections: [{ countryId: "US" }],
  };
  return {
    collection: (name: string) => ({
      countDocuments: async () => ({ users: 3, conflicts: 1, crises: 1 })[name] ?? 0,
      find: () => ({ toArray: async () => rows[name] ?? [] }),
      findOne: async () =>
        name === "wealthListSnapshots"
          ? {
              entries: [
                { country: "United States", totalWealth: 90 },
                { country: "United States", totalWealth: 10 },
              ],
            }
          : null,
      updateOne: vi.fn().mockResolvedValue({}),
    }),
  } as unknown as Db;
}

describe("turn PostHog telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  });

  it("uses the frozen event fields and flushes one bounded batch", async () => {
    const { captureTurnPosthog } = await import("./turnPosthog");
    await captureTurnPosthog({
      db: fakeDb(),
      turn: 42,
      durationMs: 1200,
      phaseStatuses: {
        first: { status: "completed" },
        second: { status: "skipped" },
      } as unknown as Parameters<typeof captureTurnPosthog>[0]["phaseStatuses"],
      errorCount: 1,
    });

    expect(sdk.construct).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({ host: "https://us.i.posthog.com", flushInterval: 0 })
    );
    expect(sdk.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "turn_processed",
        properties: expect.objectContaining({
          turn_number: 42,
          duration_ms: 1200,
          players_active: 3,
          phases_run: 1,
          error_count: 1,
        }),
      })
    );
    expect(sdk.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "economy_snapshot",
        properties: expect.objectContaining({
          turn_number: 42,
          nation_id: "US",
          treasury: 1000,
          total_player_wealth: 100,
          top_1pct_wealth_share: 0.9,
          inflation_rate: 2.5,
        }),
      })
    );
    expect(sdk.capture.mock.calls.filter(([call]) => call.event === "world_event")).toHaveLength(5);
    expect(sdk.flush).toHaveBeenCalledTimes(1);
  });

  it("contains an SDK failure", async () => {
    sdk.flush.mockRejectedValueOnce(new Error("network unavailable"));
    const { captureTurnPosthog } = await import("./turnPosthog");
    await expect(
      captureTurnPosthog({
        db: fakeDb(),
        turn: 43,
        durationMs: 100,
        phaseStatuses: {} as Parameters<typeof captureTurnPosthog>[0]["phaseStatuses"],
        errorCount: 0,
      })
    ).resolves.toBeUndefined();
  });
});
