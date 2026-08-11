import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn().mockResolvedValue(true) }));

/** Captures the filter the route hands to `unions.find`. */
const unionFind = vi.fn();

function mockDb() {
  const emptyCursor = {
    sort: () => emptyCursor,
    toArray: async () => [],
    project: () => emptyCursor,
  };
  return {
    collection: (name: string) => {
      if (name === "unions") {
        return {
          distinct: async () => ["UK", "US"],
          find: (filter: unknown) => {
            unionFind(filter);
            return emptyCursor;
          },
        };
      }
      return { find: () => emptyCursor };
    },
  };
}

async function get(url: string) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(mockDb() as never);
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
