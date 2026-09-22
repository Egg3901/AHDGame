import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
// Static import so the route module graph transforms at collect time instead
// of inside the first test's timeout.
import { GET } from "./route";

vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

interface RecordedOp {
  collection: string;
  op: "findOne" | "find" | "aggregate";
  filter?: unknown;
  options?: unknown;
}

interface FakeSeed {
  findOne?: Record<string, unknown> | null;
  find?: Record<string, unknown>[];
  aggregate?: Record<string, unknown>[];
}

function createFakeDb(seeds: Record<string, FakeSeed>, ops: RecordedOp[]): Db {
  const collection = (name: string) => ({
    findOne: async (filter?: unknown, options?: unknown) => {
      ops.push({ collection: name, op: "findOne", filter, options });
      return (seeds[name]?.findOne ?? null) as never;
    },
    find: (filter?: unknown, options?: unknown) => {
      ops.push({ collection: name, op: "find", filter, options });
      const rows = (seeds[name]?.find ?? []) as never[];
      const cursor = {
        project: () => cursor,
        sort: () => cursor,
        limit: () => cursor,
        toArray: async () => rows,
      };
      return cursor;
    },
    aggregate: () => {
      ops.push({ collection: name, op: "aggregate" });
      const rows = (seeds[name]?.aggregate ?? []) as never[];
      return { toArray: async () => rows };
    },
  });
  return { collection } as unknown as Db;
}

const ENRICHMENT_COLLECTIONS = [
  "corporations",
  "bonds",
  "unionOrganizers",
  "unions",
  "corporateSectors",
  "gameState",
  "centralBanks",
  "gameConfig",
  "cabinetMembers",
  "electionCandidates",
  "elections",
  "electionVoteTallies",
  "corporationHistory",
  "stockExchangeSnapshots",
];

function seedIndependentCharacter(userId: ObjectId): Record<string, FakeSeed> {
  const characterId = new ObjectId();
  return {
    users: {
      findOne: { _id: userId, activeCharacterType: "standard" },
    },
    characters: {
      findOne: {
        _id: characterId,
        userId,
        name: "Test Character",
        homeState: "CA",
        countryId: "US",
        party: "independent",
        actions: 10,
        funds: 100,
        cashOnHand: 50,
        donorBaseLevel: 0,
        politicalInfluence: 0,
        favorability: 0,
        currentOffice: null,
        policies: { economic: 0, social: 0 },
        partyInfluence: 0,
        stats: { energy: 100 },
      },
    },
    states: {
      findOne: { _id: "CA", countryId: "US", population: 1000000, gdp: 1000000 },
    },
    gameState: { findOne: { _id: "current", preset: "2019-default" } },
    exchangeRates: { find: [] },
  };
}

describe("GET /api/client-status", () => {
  it("returns the shared auth failure response for banned or revoked sessions", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    });

    const { getDb } = await import("@/lib/mongodb");
    const response = await GET(new Request("http://localhost/api/client-status"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(getDb).not.toHaveBeenCalled();
  });

  describe("layout-gated query fanout (#2167)", () => {
    let ops: RecordedOp[];

    beforeEach(async () => {
      ops = [];
      const { resetCorpFxRateCacheForTests } = await import("@/lib/currency/corporationCapital");
      resetCorpFxRateCacheForTests();
    });

    async function getWithLayout(layout: string) {
      const userId = new ObjectId();
      const { requireBasicAuth } = await import("@/lib/api/requireAuth");
      vi.mocked(requireBasicAuth).mockResolvedValue({
        ok: true,
        user: { userId: userId.toHexString() },
      } as never);
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(createFakeDb(seedIndependentCharacter(userId), ops));
      const response = await GET(
        new Request(`http://localhost/api/client-status?layout=${layout}`)
      );
      return { response, body: (await response.json()) as Record<string, unknown> };
    }

    it("projects the user lookup instead of reading the full user document", async () => {
      const { response } = await getWithLayout("minimal");
      expect(response.status).toBe(200);
      const userOps = ops.filter((op) => op.collection === "users" && op.op === "findOne");
      expect(userOps).toHaveLength(1);
      const projection = (userOps[0].options as { projection?: Record<string, unknown> })
        ?.projection;
      expect(projection).toBeDefined();
      expect(projection).toMatchObject({ activeCharacterId: 1 });
    });

    it("minimal layout skips every enrichment collection", async () => {
      const { response, body } = await getWithLayout("minimal");
      expect(response.status).toBe(200);
      expect(body.name).toBe("Test Character");
      const touched = new Set(
        ops
          .filter((op) => ENRICHMENT_COLLECTIONS.includes(op.collection))
          .map((op) => op.collection)
      );
      expect([...touched]).toEqual([]);
    });

    it("minimal layout returns core fields with null enrichment", async () => {
      const { body } = await getWithLayout("minimal");
      expect(body.actions).toBe(10);
      expect(body.funds).toBe(100);
      expect(body.campaignIncomeBreakdown).toBeNull();
      expect(body.corpNav).toBeNull();
      expect(body.electionStats).toBeNull();
      expect(body.dividendIncome).toBe(0);
      expect(body.bondIncome).toBe(0);
    });

    it("imperial dividend/bond lookups stay scoped to the imperial holder", async () => {
      const imperialId = new ObjectId();
      const userId = new ObjectId();
      const { requireBasicAuth } = await import("@/lib/api/requireAuth");
      vi.mocked(requireBasicAuth).mockResolvedValue({
        ok: true,
        user: { userId: userId.toHexString() },
      } as never);
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(
        createFakeDb(
          {
            users: {
              findOne: {
                _id: userId,
                activeCharacterType: "imperial",
                activeImperialCharacterId: imperialId,
              },
            },
            imperialCharacters: {
              findOne: { _id: imperialId, userId, name: "Imperial Test" },
            },
            exchangeRates: { find: [] },
          },
          ops
        )
      );
      const response = await GET(new Request("http://localhost/api/client-status?layout=full"));
      expect(response.status).toBe(200);
      const corpFinds = ops.filter((op) => op.collection === "corporations" && op.op === "find");
      expect(corpFinds).toHaveLength(1);
      expect(corpFinds[0].filter).toMatchObject({
        "shareholders.imperialCharacterId": imperialId,
      });
      const bondFinds = ops.filter((op) => op.collection === "bonds" && op.op === "find");
      expect(bondFinds).toHaveLength(1);
      expect(bondFinds[0].filter).toMatchObject({
        "holders.imperialCharacterId": imperialId,
      });
    });

    it("minimal imperial layout skips dividend and bond lookups", async () => {
      const imperialId = new ObjectId();
      const userId = new ObjectId();
      const { requireBasicAuth } = await import("@/lib/api/requireAuth");
      vi.mocked(requireBasicAuth).mockResolvedValue({
        ok: true,
        user: { userId: userId.toHexString() },
      } as never);
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(
        createFakeDb(
          {
            users: {
              findOne: {
                _id: userId,
                activeCharacterType: "imperial",
                activeImperialCharacterId: imperialId,
              },
            },
            imperialCharacters: {
              findOne: { _id: imperialId, userId, name: "Imperial Test" },
            },
            exchangeRates: { find: [] },
          },
          ops
        )
      );
      const response = await GET(new Request("http://localhost/api/client-status?layout=minimal"));
      expect(response.status).toBe(200);
      const touched = new Set(ops.map((op) => op.collection));
      expect(touched.has("corporations")).toBe(false);
      expect(touched.has("bonds")).toBe(false);
      expect(touched.has("corporationHistory")).toBe(false);
    });

    it("standard layout keeps enrichment but skips election and corp-market reads", async () => {
      const { response, body } = await getWithLayout("standard");
      expect(response.status).toBe(200);
      expect(body.campaignIncomeBreakdown).not.toBeNull();
      const touched = new Set(ops.map((op) => op.collection));
      for (const skipped of [
        "electionCandidates",
        "elections",
        "electionVoteTallies",
        "corporationHistory",
        "stockExchangeSnapshots",
      ]) {
        expect(touched.has(skipped)).toBe(false);
      }
      // Dividend/bond income still served for the standard personal-cash tooltip.
      expect(touched.has("corporations")).toBe(true);
      expect(touched.has("bonds")).toBe(true);
    });
  });
});
