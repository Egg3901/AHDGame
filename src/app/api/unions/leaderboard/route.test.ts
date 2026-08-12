import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn().mockResolvedValue(true) }));

/** Captures the filter the route hands to `unions.find`. */
const unionFind = vi.fn();

function mockDb(unions: Array<Record<string, unknown>> = []) {
  const emptyCursor = {
    sort: () => emptyCursor,
    toArray: async () => [],
    project: () => emptyCursor,
  };
  const unionCursor = {
    sort: () => unionCursor,
    toArray: async () => unions,
  };
  return {
    collection: (name: string) => {
      if (name === "unions") {
        return {
          distinct: async () => ["UK", "US"],
          find: (filter: unknown) => {
            unionFind(filter);
            return unionCursor;
          },
        };
      }
      if (name === "characters") {
        return {
          find: () => ({
            toArray: async () =>
              unions
                .filter((u) => u.ownerId && u.ownerType !== "npp")
                .map((u) => ({ _id: u.ownerId, name: "Player Lead" })),
          }),
        };
      }
      if (name === "npps") {
        return {
          find: () => ({
            toArray: async () =>
              unions
                .filter((u) => u.ownerId && u.ownerType === "npp")
                .map((u) => ({ _id: u.ownerId, name: "Klaus Weber", sequentialId: 88 })),
          }),
        };
      }
      return { find: () => emptyCursor };
    },
  };
}

async function get(url: string, unions: Array<Record<string, unknown>> = []) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(mockDb(unions) as never);
  const { GET } = await import("./route");
  return GET(new NextRequest(url));
}

describe("GET /api/unions/leaderboard country scoping", () => {
  beforeEach(() => unionFind.mockClear());

  it("matches a lower-case country code instead of falling back to every country", async () => {
    await get("http://localhost/api/unions/leaderboard?country=uk");
    expect(unionFind).toHaveBeenCalledWith({ countryId: "UK" });
  });

  it("still scopes an upper-case country code", async () => {
    await get("http://localhost/api/unions/leaderboard?country=UK");
    expect(unionFind).toHaveBeenCalledWith({ countryId: "UK" });
  });

  it("returns every country when no code is given", async () => {
    await get("http://localhost/api/unions/leaderboard");
    expect(unionFind).toHaveBeenCalledWith({});
  });
});

describe("GET /api/unions/leaderboard NPP presidents", () => {
  beforeEach(() => unionFind.mockClear());

  it("names an NPP-run union from the npps collection instead of Unknown", async () => {
    const nppId = new ObjectId();
    const res = await get("http://localhost/api/unions/leaderboard?country=DD", [
      {
        _id: new ObjectId(),
        name: "East German Manufacturing Workers",
        countryId: "DD",
        sectorType: "manufacturing",
        ownerId: nppId,
        ownerType: "npp",
        membershipPressure: 40,
        treasury: 100,
        demandedWageLevel: null,
      },
    ]);
    const body = await res.json();
    expect(body.unions[0].leaderName).toBe("Klaus Weber");
  });
});
