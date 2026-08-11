import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

function aggregateCursorOf(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
  };
}

describe("queryLeaderboard", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["characters", "politicalParties", "users", "exchangeRates"].forEach((n) => db.collection(n));
  });

  function mockRates(rows: Record<string, unknown>[]) {
    db.collectionMocks.exchangeRates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    } as never);
  }

  it("normalises nationalInfluence field name consistently", async () => {
    db.collectionMocks.characters!.aggregate.mockReturnValue(
      aggregateCursorOf([
        {
          _id: "char1",
          name: "Jane Smith",
          countryId: "US",
          party: "1",
          homeState: "CA",
          currentOffice: null,
          politicalInfluence: 42,
          nationalInfluence: 18,
          nationalPoliticalInfluence: 18,
          favorability: 55,
          actions: 4,
          currencyBalances: { campaign: 10000 },
        },
      ])
    );
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryLeaderboard } = await import("./market");
    const result = await queryLeaderboard(db as unknown as Db, { country: "US", metric: "npi" });

    expect(result.characters[0]).toHaveProperty("nationalInfluence", 18);
    expect(result.characters[0]).not.toHaveProperty("nationalPoliticalInfluence");
  });

  it("excludes characters whose owning user is banned", async () => {
    db.collectionMocks.characters!.aggregate.mockReturnValue(
      aggregateCursorOf([
        {
          _id: "char1",
          name: "Allowed",
          countryId: "US",
          party: null,
          homeState: "CA",
          currentOffice: null,
          politicalInfluence: 10,
          favorability: 50,
          actions: 1,
        },
      ])
    );
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryLeaderboard } = await import("./market");
    const result = await queryLeaderboard(db as unknown as Db, { country: "US", metric: "pi" });

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name).toBe("Allowed");
  });

  it("resolves parties by country-specific sequential id", async () => {
    db.collectionMocks.characters!.aggregate.mockReturnValue(
      aggregateCursorOf([
        {
          _id: "char1",
          name: "US Red",
          countryId: "US",
          party: "1",
          homeState: "CA",
          currentOffice: null,
          politicalInfluence: 10,
          favorability: 50,
          actions: 1,
        },
        {
          _id: "char2",
          name: "DE Red",
          countryId: "DE",
          party: "1",
          homeState: "BW",
          currentOffice: null,
          politicalInfluence: 20,
          favorability: 50,
          actions: 1,
        },
      ])
    );
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { sequentialId: 1, countryId: "US", name: "US Red Party", color: "#ff0000" },
        { sequentialId: 1, countryId: "DE", name: "DE Red Party", color: "#cc0000" },
      ]),
    } as never);

    const { queryLeaderboard } = await import("./market");
    const result = await queryLeaderboard(db as unknown as Db, { metric: "pi", limit: 10 });

    expect(result.characters[0].party).toBe("US Red Party");
    expect(result.characters[0].partyColor).toBe("#ff0000");
    expect(result.characters[1].party).toBe("DE Red Party");
    expect(result.characters[1].partyColor).toBe("#cc0000");
  });

  it("ranks funds across countries by forex-normalized value", async () => {
    // Raw funds are equal, but UK's rate (0.5 local per internal) makes £1000
    // worth 2000 internal vs $1000 = 1000 internal — so UK must rank first.
    db.collectionMocks.characters!.aggregate.mockReturnValue(
      aggregateCursorOf([
        {
          _id: "us1",
          name: "US Rich",
          countryId: "US",
          party: null,
          homeState: "CA",
          currentOffice: null,
          currencyBalances: { campaign: 1000 },
        },
        {
          _id: "uk1",
          name: "UK Rich",
          countryId: "UK",
          party: null,
          homeState: "LDN",
          currentOffice: null,
          currencyBalances: { campaign: 1000 },
        },
      ])
    );
    mockRates([
      { countryId: "US", rate: 1, baseRate: 1 },
      { countryId: "UK", rate: 0.5, baseRate: 0.5 },
    ]);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryLeaderboard } = await import("./market");
    const result = await queryLeaderboard(db as unknown as Db, { metric: "funds", limit: 10 });

    expect(result.characters.map((c) => c.name)).toEqual(["UK Rich", "US Rich"]);
    expect(result.characters[0]).toMatchObject({
      funds: 1000,
      fundsInternal: 2000,
      nativeCurrencyCode: "GBP",
    });
    expect(result.characters[1]).toMatchObject({
      funds: 1000,
      fundsInternal: 1000,
      nativeCurrencyCode: "USD",
    });
  });

  it("exposes funds/fundsInternal/nativeCurrencyCode for non-funds metrics too", async () => {
    db.collectionMocks.characters!.aggregate.mockReturnValue(
      aggregateCursorOf([
        {
          _id: "uk1",
          name: "UK Player",
          countryId: "UK",
          party: null,
          homeState: "LDN",
          currentOffice: null,
          politicalInfluence: 99,
          currencyBalances: { campaign: 800 },
        },
      ])
    );
    mockRates([{ countryId: "UK", rate: 0.5, baseRate: 0.5 }]);
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryLeaderboard } = await import("./market");
    const result = await queryLeaderboard(db as unknown as Db, { metric: "pi", limit: 10 });

    expect(result.characters[0]).toMatchObject({
      funds: 800,
      fundsInternal: 1600,
      nativeCurrencyCode: "GBP",
    });
  });

  it("clamps limit to at least 1", async () => {
    db.collectionMocks.characters!.aggregate.mockReturnValue(aggregateCursorOf([]));

    const { queryLeaderboard } = await import("./market");
    const result = await queryLeaderboard(db as unknown as Db, {
      country: "US",
      metric: "pi",
      limit: -5,
    });

    expect(result.characters).toEqual([]);
    expect(db.collectionMocks.characters!.aggregate).toHaveBeenCalled();
    const pipeline = db.collectionMocks.characters!.aggregate.mock.calls[0][0] as unknown[];
    const limitStage = pipeline.find((s) => typeof s === "object" && s && "$limit" in s);
    expect(limitStage).toEqual({ $limit: 1 });
  });

  it("joins users with a typed localField/foreignField lookup (no $toString on _id)", async () => {
    // Regression guard for #2790: userId and users._id are both ObjectIds, so
    // the banned-user join must compare them natively. A $toString-coerced
    // $expr never matches an ObjectId and defeats the _id index.
    db.collectionMocks.characters!.aggregate.mockReturnValue(aggregateCursorOf([]));

    const { queryLeaderboard } = await import("./market");
    await queryLeaderboard(db as unknown as Db, { country: "US", metric: "pi" });

    const pipeline = db.collectionMocks.characters!.aggregate.mock.calls[0][0] as Record<
      string,
      unknown
    >[];
    const lookupStage = pipeline.find((s) => "$lookup" in s)?.$lookup as Record<string, unknown>;
    expect(lookupStage).toMatchObject({
      from: "users",
      localField: "userId",
      foreignField: "_id",
    });
    expect(JSON.stringify(pipeline)).not.toContain("$toString");
  });
});
