import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import {
  buildCorporationNationalRevenueShareByMarket,
  corporationNationalSectorShareKey,
  fetchCorporationNationalSectorSharesByCountry,
} from "./marketShare";

describe("fetchCorporationNationalSectorSharesByCountry", () => {
  it("aggregates the corporation and market across every state in the host country", async () => {
    const corporationId = new ObjectId();
    const rivalId = new ObjectId();
    const statesFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "US-TX", countryId: "US" },
        { _id: "US-CA", countryId: "US" },
      ]),
    });
    const sectorsFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { corporationId, stateId: "US-TX", sectorType: "logistics", revenue: 100 },
        { corporationId, stateId: "US-CA", sectorType: "logistics", revenue: 300 },
        { corporationId: rivalId, stateId: "US-TX", sectorType: "logistics", revenue: 100 },
        { corporationId: rivalId, stateId: "US-CA", sectorType: "logistics", revenue: 500 },
      ]),
    });
    const db = {
      collection: (name: string) =>
        name === "states" ? { find: statesFind } : { find: sectorsFind },
    } as unknown as Db;

    const shares = await fetchCorporationNationalSectorSharesByCountry(db, {
      corporationId,
      sectorType: "logistics" as CorporateSector["sectorType"],
      countryIds: ["US"],
    });

    expect(shares.get("US")).toBeCloseTo(40, 8);
    expect(statesFind).toHaveBeenCalledWith(
      { countryId: { $in: ["US"] } },
      { projection: { _id: 1, countryId: 1 } }
    );
    expect(sectorsFind).toHaveBeenCalledWith(
      {
        stateId: { $in: ["US-TX", "US-CA"] },
        sectorType: "logistics",
        industryModel: null,
      },
      {
        projection: {
          corporationId: 1,
          stateId: 1,
          sectorType: 1,
          industryModel: 1,
          revenue: 1,
        },
      }
    );
  });

  it("builds the same lookup from an already-loaded turn snapshot", () => {
    const corporationId = new ObjectId();
    const rivalId = new ObjectId();
    const shares = buildCorporationNationalRevenueShareByMarket([
      {
        corporationId,
        countryId: "US",
        stateId: "US-TX",
        sectorType: "logistics",
        revenue: 400,
      },
      {
        corporationId: rivalId,
        countryId: "US",
        stateId: "US-CA",
        sectorType: "logistics",
        revenue: 600,
      },
    ] as CorporateSector[]);

    expect(
      shares.get(corporationNationalSectorShareKey(corporationId, "US", "logistics"))
    ).toBeCloseTo(40, 8);
  });

  it("keeps generic manufacturing and vehicle-model national shares separate", () => {
    const corporationId = new ObjectId();
    const rivalId = new ObjectId();
    const shares = buildCorporationNationalRevenueShareByMarket([
      {
        corporationId,
        countryId: "US",
        stateId: "US-MI",
        sectorType: "manufacturing",
        industryModel: "vehicles",
        revenue: 300,
      },
      {
        corporationId: rivalId,
        countryId: "US",
        stateId: "US-TX",
        sectorType: "manufacturing",
        industryModel: "vehicles",
        revenue: 700,
      },
      {
        corporationId,
        countryId: "US",
        stateId: "US-NY",
        sectorType: "manufacturing",
        revenue: 1_000,
      },
    ] as CorporateSector[]);

    expect(
      shares.get(
        corporationNationalSectorShareKey(corporationId, "US", "manufacturing", "vehicles")
      )
    ).toBe(30);
    expect(
      shares.get(corporationNationalSectorShareKey(corporationId, "US", "manufacturing"))
    ).toBe(100);
  });

  it("keeps legacy rows that can inherit a country from their state siblings", () => {
    const corporationId = new ObjectId();
    const shares = buildCorporationNationalRevenueShareByMarket([
      {
        corporationId,
        countryId: "US",
        stateId: "US-TX",
        sectorType: "logistics",
        revenue: 300,
      },
      {
        corporationId,
        stateId: "US-TX",
        sectorType: "logistics",
        revenue: 200,
      },
      {
        corporationId: new ObjectId(),
        countryId: "US",
        stateId: "US-CA",
        sectorType: "logistics",
        revenue: 500,
      },
    ] as CorporateSector[]);

    expect(
      shares.get(corporationNationalSectorShareKey(corporationId, "US", "logistics"))
    ).toBeCloseTo(50, 8);
  });
});
