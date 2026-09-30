import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn().mockResolvedValue([]) }));

const state = {
  history: [] as { turn: number; createdAt: Date; globalMarketCap: number }[],
  prints: [] as {
    turn: number;
    open: number;
    high: number;
    low: number;
    last: number;
    prints: number;
  }[],
  volumes: [] as { _id: number; volume: number }[],
};
const limit = vi.fn();
const find = vi.fn();

const request = (turns: number, exchange = "global") =>
  GET(
    new Request(`http://localhost/api/stock-exchange/candles?exchange=${exchange}&turns=${turns}`)
  );

function fixture(n: number) {
  state.history = Array.from({ length: n }, (_, i) => ({
    turn: i + 1,
    createdAt: new Date((i + 1) * 3600_000),
    globalMarketCap: 35,
  })).reverse();
}

describe("market candle API", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.prints = [];
    state.volumes = [];
    fixture(3);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) => ({
        find: (query: unknown) => {
          find(name, query);
          let take = 0;
          const cursor = {
            sort: () => cursor,
            limit: (n: number) => {
              limit(n);
              take = n;
              return cursor;
            },
            project: () => cursor,
            toArray: async () =>
              name === "marketCapHistory"
                ? take
                  ? state.history.slice(0, take)
                  : [...state.history]
                : state.prints,
          };
          return cursor;
        },
        aggregate: () => ({ toArray: async () => state.volumes }),
      }),
    } as unknown as Db);
  });

  it("uses print opens and closes on the same basis as high/low", async () => {
    state.prints = [{ turn: 3, open: 40, high: 42, low: 39, last: 39.3, prints: 5 }];
    const response = await request(24);
    const body = await response.json();
    expect(body.points[2]).toMatchObject({ open: 40, high: 42, low: 39, close: 39.3 });
    expect(body).toMatchObject({ totalTurns: 3, intradayTurns: 1, firstIntradayTurn: 3 });
    expect(response.headers.get("cache-control")).toContain("private");
  });

  it("loads the predecessor without including it in the selected range", async () => {
    fixture(25);
    state.history[24].globalMarketCap = 100;
    const body = await (await request(24)).json();
    expect(body.points).toHaveLength(24);
    expect(body.points[0]).toMatchObject({ turn: 2, open: 100, close: 35 });
    expect(limit).toHaveBeenCalledWith(25);
  });

  it("returns daily price/volume buckets and underlying coverage for ALL", async () => {
    fixture(1252);
    state.volumes = [
      { _id: 1, volume: 10 },
      { _id: 24, volume: 20 },
      { _id: 25, volume: 5 },
    ];
    state.prints = [{ turn: 1252, open: 40, high: 42, low: 39, last: 39.3, prints: 5 }];
    const body = await (await request(0)).json();
    expect(body.points).toHaveLength(53);
    expect(body).toMatchObject({
      bucketTurns: 24,
      totalTurns: 1252,
      intradayTurns: 1,
      firstIntradayTurn: 1252,
    });
    expect(body.points[0]).toMatchObject({ turn: 1, time: 3600, volume: 30 });
    expect(body.points[1].volume).toBe(5);
    expect(body.points.at(-1)).toMatchObject({ close: 39.3, intradayTurns: 1, totalTurns: 4 });
  });

  it("does not silently truncate ALL history at 2000 turns", async () => {
    fixture(2500);
    const body = await (await request(0)).json();
    expect(body.totalTurns).toBe(2500);
    expect(body.points[0].turn).toBe(1);
    expect(limit).toHaveBeenCalledWith(0);
  });

  it("rejects unsupported ranges and hides inaccessible venues", async () => {
    expect((await request(99)).status).toBe(400);
    const body = await (await request(24, "nyse")).json();
    expect(body.points).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});
