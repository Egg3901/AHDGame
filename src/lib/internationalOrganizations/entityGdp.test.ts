import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("loadGdpUsdMillionsByEntity", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Playable: two regions summing to 400,000 USD millions. US has a 1.0 rate,
    // so the local figure and the USD figure coincide.
    db.collection("states").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        { countryId: "US", gdp: 250_000, population: 1 },
        { countryId: "US", gdp: 150_000, population: 1 },
      ]),
    });
    // Macro: per-turn capacities summing to 125 → 6,000 a year at 48 turns.
    db.collection("macroCountries").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { entityId: "JO", sectors: { agriculture: { capacity: 75 }, retail: { capacity: 50 } } },
        ]),
    });
  });

  it("reads a playable country's live regional GDP", async () => {
    const { loadGdpUsdMillionsByEntity } = await import("./entityGdp");
    const m = await loadGdpUsdMillionsByEntity(db as unknown as Db, ["US"]);
    expect(m.get("US")).toBe(400_000);
  });

  it("annualises a macro entity's live sector capacity", async () => {
    const { loadGdpUsdMillionsByEntity } = await import("./entityGdp");
    const m = await loadGdpUsdMillionsByEntity(db as unknown as Db, ["JO"]);
    // 125 per turn × 48 turns. Live, not the seeded figure.
    expect(m.get("JO")).toBe(6_000);
  });

  it("serves both kinds in one call", async () => {
    const { loadGdpUsdMillionsByEntity } = await import("./entityGdp");
    const m = await loadGdpUsdMillionsByEntity(db as unknown as Db, ["US", "JO"]);
    expect([...m.keys()].sort()).toEqual(["JO", "US"]);
  });

  it("omits an entity with no economic data rather than calling it zero", async () => {
    // Zero would make a country free to influence and exempt from tribute, so
    // absence has to stay distinguishable from poverty.
    const { loadGdpUsdMillionsByEntity } = await import("./entityGdp");
    const m = await loadGdpUsdMillionsByEntity(db as unknown as Db, ["ZZ"]);
    expect(m.has("ZZ")).toBe(false);
  });

  it("returns an empty map for an empty roster without touching the database", async () => {
    const { loadGdpUsdMillionsByEntity } = await import("./entityGdp");
    const m = await loadGdpUsdMillionsByEntity(db as unknown as Db, []);
    expect(m.size).toBe(0);
    expect(db.collection("macroCountries").find).not.toHaveBeenCalled();
  });
});
