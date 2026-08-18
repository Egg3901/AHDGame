import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { loadCorporationDefenceContracts } from "./corporationDefenceContracts";

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();

function stubDb(opts: {
  contracts: Record<string, unknown>[];
  sectors?: Record<string, unknown>[];
  corp?: Record<string, unknown> | null;
  /** Live commodity book. Empty leaves every recipe at its nominal input share. */
  commodityPrices?: Record<string, unknown>[];
}): Db {
  return {
    collection: (name: string) => {
      if (name === "defenceContracts") {
        return {
          find: () => ({ sort: () => ({ toArray: async () => opts.contracts }) }),
        };
      }
      if (name === "corporateSectors") {
        return { find: () => ({ toArray: async () => opts.sectors ?? [] }) };
      }
      if (name === "commodityPrices") {
        // The order book quotes each contract's break-even at LIVE input prices now, so the
        // query reads the price book once. An empty book leaves the nominal recipe share.
        return { find: () => ({ toArray: async () => opts.commodityPrices ?? [] }) };
      }
      return { findOne: async () => opts.corp ?? null };
    },
  } as unknown as Db;
}

const contract = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  countryId: "US",
  corporationId: CORP_ID,
  sectorId: SECTOR_ID,
  component: "ground",
  lotsOrdered: 100,
  lotsDelivered: 40,
  pricePerLot: 1_000,
  status: "active",
  ...over,
});

const sector = (over: Record<string, unknown> = {}) => ({
  _id: SECTOR_ID,
  strategyId: "munitions",
  revenue: 10_000_000,
  ...over,
});

describe("loadCorporationDefenceContracts", () => {
  it("reports nothing for a corporation with no contracts", async () => {
    const v = await loadCorporationDefenceContracts(
      stubDb({ contracts: [], corp: { unlockedTechNodeIds: [] } }),
      CORP_ID,
      1953
    );
    expect(v.contracts).toEqual([]);
    expect(v.totalEarned).toBe(0);
  });

  it("reports what each contract has earned so far", async () => {
    const v = await loadCorporationDefenceContracts(
      stubDb({ contracts: [contract()], sectors: [sector()], corp: {} }),
      CORP_ID,
      1953
    );
    expect(v.contracts[0].earned).toBe(40 * 1_000);
    expect(v.totalEarned).toBe(40 * 1_000);
  });

  it("projects what the plant will deliver next turn", async () => {
    const v = await loadCorporationDefenceContracts(
      stubDb({ contracts: [contract()], sectors: [sector()], corp: {} }),
      CORP_ID,
      1953
    );
    expect(v.contracts[0].projectedLotsPerTurn).toBeGreaterThan(0);
  });

  // A re-tooled line cannot deliver against a contract frozen to another component, so
  // projecting output for it would promise deliveries that will never arrive.
  it("projects nothing once the plant has been re-tooled off the component", async () => {
    const v = await loadCorporationDefenceContracts(
      stubDb({
        contracts: [contract()],
        sectors: [sector({ strategyId: "naval_systems" })],
        corp: {},
      }),
      CORP_ID,
      1953
    );
    expect(v.contracts[0].projectedLotsPerTurn).toBe(0);
  });

  it("projects nothing for a closed contract", async () => {
    const v = await loadCorporationDefenceContracts(
      stubDb({
        contracts: [contract({ status: "cancelled" })],
        sectors: [sector()],
        corp: {},
      }),
      CORP_ID,
      1953
    );
    expect(v.contracts[0].projectedLotsPerTurn).toBe(0);
  });

  it("still counts what a closed contract earned before it closed", async () => {
    const v = await loadCorporationDefenceContracts(
      stubDb({
        contracts: [contract({ status: "complete", lotsDelivered: 100 })],
        sectors: [sector()],
        corp: {},
      }),
      CORP_ID,
      1953
    );
    expect(v.totalEarned).toBe(100 * 1_000);
  });

  it("survives a sector that has since been deleted", async () => {
    const v = await loadCorporationDefenceContracts(
      stubDb({ contracts: [contract()], sectors: [], corp: {} }),
      CORP_ID,
      1953
    );
    expect(v.contracts[0].projectedLotsPerTurn).toBe(0);
  });

  it("reports the grade ceiling the corporation's research affords", async () => {
    const none = await loadCorporationDefenceContracts(
      stubDb({ contracts: [], corp: { unlockedTechNodeIds: [] } }),
      CORP_ID,
      1953
    );
    expect(none.gradeCeiling).toBe(0);

    const researched = await loadCorporationDefenceContracts(
      stubDb({
        contracts: [],
        corp: {
          unlockedTechNodeIds: ["defense-1940-1", "defense-1950-1"],
          techDecadeLane: { "1940": "sector", "1950": "sector" },
        },
      }),
      CORP_ID,
      1953
    );
    expect(researched.gradeCeiling).toBeGreaterThan(0);
  });
});
