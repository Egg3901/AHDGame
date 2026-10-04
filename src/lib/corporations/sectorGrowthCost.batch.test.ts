import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { COUNTRY_ORDER, getCountryConfig } from "@/lib/constants/countries";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resolveCountryPrimeRates } from "./sectorGrowthCost";

describe("resolveCountryPrimeRates", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("centralBanks");
    db.collectionMocks.centralBanks.find.mockReturnValue({
      project: function () {
        return this;
      },
      toArray: async () => [],
    } as never);
  });

  it("loads prime rates for many countries in one query", async () => {
    const countryIds = COUNTRY_ORDER.slice(0, 16);

    const rates = await resolveCountryPrimeRates(db as unknown as Db, countryIds);

    expect(rates.size).toBe(countryIds.length);
    expect(rates.get(countryIds[0]!)).toBe(
      getCountryConfig(countryIds[0]!).centralBank.defaultPrimeRate
    );
    expect(db.collectionMocks.centralBanks.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.centralBanks.findOne).not.toHaveBeenCalled();
  });
});
