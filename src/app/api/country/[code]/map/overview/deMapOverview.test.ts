/**
 * Map overview API tests for DE.
 */
import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/country/[code]/map/overview/route";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

function mockDb() {
  return {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "states") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              { _id: "BW", name: "Baden-Württemberg", countryId: "DE" },
              { _id: "BY", name: "Bavaria", countryId: "DE" },
            ]),
          }),
        };
      }
      if (name === "stateDemographics") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "demographicCategories") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "macroMetrics") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              { _id: "BW", approval: 62 },
              { _id: "BY", approval: 58 },
            ]),
          }),
        };
      }
      if (name === "statePartyOrg") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "seats") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      if (name === "gameState") {
        return { findOne: vi.fn().mockResolvedValue({ preset: "2019-default" }) };
      }
      return {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        findOne: vi.fn().mockResolvedValue(null),
      };
    }),
  } as unknown as import("mongodb").Db;
}

const { getDb } = await import("@/lib/mongodb");

describe("GET /api/country/DE/map/overview", () => {
  it("returns DE map data with lean and approval", async () => {
    vi.mocked(getDb).mockResolvedValue(mockDb());
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "de" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.lean).toBeDefined();
    expect(json.lean.BW).toBeDefined();
    expect(json.lean.BW.name).toBe("Baden-Württemberg");
    expect(json.approval).toBeDefined();
    expect(json.approval.BW.approval).toBeDefined();
    expect(json.approval.BY.approval).toBeDefined();
  });
});
