/**
 * Map overview API tests for CN.
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
              { _id: "HD", name: "East China", countryId: "CN" },
              { _id: "HB", name: "North China", countryId: "CN" },
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
      if (name === "stateMetrics") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              { _id: "HD", approval: 72 },
              { _id: "HB", approval: 65 },
            ]),
          }),
        };
      }
      if (name === "statePartyOrg") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              { _id: "HD_1", organization: 85 },
              { _id: "HD_2", organization: 8 },
              { _id: "HB_1", organization: 80 },
            ]),
          }),
        };
      }
      if (name === "seats") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              { state: "HD", officeType: "npcDelegate", totalSeats: 600 },
              { state: "HB", officeType: "npcDelegate", totalSeats: 500 },
            ]),
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

describe("GET /api/country/CN/map/overview", () => {
  it("returns CN map data with party org and NPC seats", async () => {
    vi.mocked(getDb).mockResolvedValue(mockDb());
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "cn" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.lean).toBeDefined();
    expect(json.lean.HD).toBeDefined();
    expect(json.lean.HD.name).toBe("East China");
    expect(json.partyOrg).toBeDefined();
    expect(json.partyOrg.HD["1"]).toBe(85);
    expect(json.partyOrg.HD["2"]).toBe(8);
    expect(json.npcSeats).toBeDefined();
    expect(json.npcSeats.HD).toBe(600);
    expect(json.npcSeats.HB).toBe(500);
  });
});
