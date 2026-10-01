import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { GET } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn().mockResolvedValue([]) }));
const state = {
  history: [] as {
    turn: number;
    createdAt: Date;
    globalMarketCap: number;
    listingUniverse?: "public-only";
  }[],
  prints: [] as {
    turn: number;
    open: number;
    high: number;
    low: number;
    last: number;
    prints: number;
    updatedAt: Date;
  }[],
  volumes: [] as { _id: number; volume: number; invalidTrades: number }[],
  currentTurn: 3,
};
const find = vi.fn();
const aggregate = vi.fn();
const request = (turns: number, exchange = "global") =>
  GET(
    new Request(`http://localhost/api/stock-exchange/candles?exchange=${exchange}&turns=${turns}`)
  );
function fixture(n: number) {
  state.currentTurn = n;
  state.history = Array.from({ length: n }, (_, i) => ({
    turn: i + 1,
    createdAt: new Date((i + 1) * 3600_000),
    globalMarketCap: 35,
  }));
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
        findOne: async (query: { turn?: { $lt: number } }) =>
          name === "gameState"
            ? {
                currentTurn: state.currentTurn,
                startingYear: 1953,
                preIterationTurns: 48,
                lastTurnProcessed: new Date(),
              }
            : query.turn
              ? (state.history.filter((h) => h.turn < query.turn!.$lt).at(-1) ?? null)
              : (state.history.at(-1) ?? null),
        find: (query: { turn?: { $gte: number; $lte: number } }) => {
          find(name, query);
          const cursor = {
            sort: () => cursor,
            project: () => cursor,
            toArray: async () => {
              const rows = name === "marketCapHistory" ? state.history : state.prints;
              return rows.filter(
                (r) => !query.turn || (r.turn >= query.turn.$gte && r.turn <= query.turn.$lte)
              );
            },
          };
          return cursor;
        },
        aggregate: (pipeline: unknown) => {
          aggregate(pipeline);
          return { toArray: async () => state.volumes };
        },
      }),
    } as unknown as Db);
  });
  it("uses print opens and closes on the same basis as high/low", async () => {
    state.prints = [
      { turn: 3, open: 40, high: 42, low: 39, last: 39.3, prints: 5, updatedAt: new Date() },
    ];
    const response = await request(24);
    const body = await response.json();
    expect(body.points[2]).toMatchObject({ open: 40, high: 42, low: 39, close: 39.3, endTurn: 3 });
    expect(body).toMatchObject({
      totalTurns: 3,
      intradayTurns: 1,
      firstIntradayTurn: 3,
      calendar: { startingYear: 1953, preIterationTurns: 48 },
    });
    expect(response.headers.get("cache-control")).toContain("private");
  });
  it("bounds by actual turn numbers despite missing records and loads the predecessor", async () => {
    fixture(30);
    state.history = state.history.filter((h) => h.turn !== 12);
    state.history[5].globalMarketCap = 100;
    const body = await (await request(24)).json();
    expect(body.points).toHaveLength(23);
    expect(body.points[0]).toMatchObject({ turn: 7, open: 100, close: 35 });
    expect(body.missingTurns).toBe(1);
    expect(find).toHaveBeenCalledWith("marketCapHistory", { turn: { $gte: 7, $lte: 30 } });
  });
  it("keeps game-quarter detail, complete history, aligned volume and bucket end dates", async () => {
    fixture(1252);
    state.volumes = [
      { _id: 1, volume: 10, invalidTrades: 0 },
      { _id: 12, volume: 20, invalidTrades: 2 },
      { _id: 13, volume: 5, invalidTrades: 0 },
    ];
    state.prints = [
      { turn: 1252, open: 40, high: 42, low: 39, last: 39.3, prints: 5, updatedAt: new Date() },
    ];
    const body = await (await request(0)).json();
    expect(body.points).toHaveLength(105);
    expect(body).toMatchObject({
      bucketTurns: 12,
      totalTurns: 1252,
      intradayTurns: 1,
      firstIntradayTurn: 1252,
      invalidVolumeTrades: 2,
    });
    expect(body.points[0]).toMatchObject({
      turn: 1,
      endTurn: 12,
      time: 3600,
      volume: 30,
      invalidVolumeTrades: 2,
    });
    expect(body.points[1].volume).toBe(5);
    expect(body.points.at(-1)).toMatchObject({
      endTurn: 1252,
      close: 39.3,
      intradayTurns: 1,
      totalTurns: 4,
    });
    expect(JSON.stringify(aggregate.mock.calls[0][0])).toContain("$isNumber");
  });
  it("does not silently truncate ALL at 2000 turns", async () => {
    fixture(2500);
    const body = await (await request(0)).json();
    expect(body.totalTurns).toBe(2500);
    expect(body.points[0].turn).toBe(1);
  });
  it("includes a newer live print before a turn-close row exists", async () => {
    state.currentTurn = 4;
    state.prints = [
      {
        turn: 4,
        open: 40,
        high: 42,
        low: 39,
        last: 41,
        prints: 1,
        updatedAt: new Date(4 * 3600_000),
      },
    ];
    const body = await (await request(48)).json();
    expect(body.latestTurn).toBe(4);
    expect(body.points.at(-1).close).toBe(41);
  });
  it("flags listing coverage transitions and large stored repricings without altering levels", async () => {
    state.history[1].globalMarketCap = 300;
    state.history[1].listingUniverse = "public-only";
    const body = await (await request(48)).json();
    expect(body.points[1].close).toBe(300);
    expect(body.points[1].notes.join(" ")).toMatch(
      /Listing coverage changed.*Large recorded valuation change/
    );
  });
  it("rejects unsupported ranges and hides inaccessible venues", async () => {
    expect((await request(99)).status).toBe(400);
    expect((await (await request(24, "nyse")).json()).points).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });
});
