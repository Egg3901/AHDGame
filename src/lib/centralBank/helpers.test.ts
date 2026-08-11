import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  buildCentralBankBootstrapUpdate,
  buildPrimeRateByCountry,
  getBankId,
  getCentralBankScope,
  getConfiguredSharedBankMemberCountries,
  getRepresentativeCentralBankCountry,
} from "./helpers";

describe("buildCentralBankBootstrapUpdate", () => {
  it("keeps shared-bank intorgId out of $setOnInsert to avoid Mongo update conflicts", () => {
    const now = new Date("2026-04-28T12:00:00.000Z");

    const update = buildCentralBankBootstrapUpdate("DE", "ECB", "EU", now);

    expect(update.$setOnInsert).toMatchObject({
      _id: "ECB",
      countryId: "DE",
      createdAt: now,
      updatedAt: now,
    });
    expect(update.$setOnInsert).not.toHaveProperty("intorgId");
    expect(update).toHaveProperty("$set.intorgId", "EU");
  });

  it("omits $set when bootstrapping a country-scoped bank", () => {
    const update = buildCentralBankBootstrapUpdate("US", "US");

    expect(update.$setOnInsert).toMatchObject({
      _id: "US",
      countryId: "US",
    });
    expect(update).not.toHaveProperty("$set");
  });
});

describe("getConfiguredSharedBankMemberCountries", () => {
  it("limits the ECB shared-bank scope to DE (IE has its own CBI)", () => {
    expect(getConfiguredSharedBankMemberCountries("ECB", "EU")).toEqual(["DE"]);
  });
});

describe("getBankId", () => {
  it("resolves IE to its own Central Bank of Ireland doc", () => {
    expect(getBankId(COUNTRY_CONFIGS.IE.id)).toBe("IE");
    expect(getBankId(COUNTRY_CONFIGS.DE.id)).toBe("ECB");
  });

  it("falls through to the country code for country-scoped banks", () => {
    expect(getBankId(COUNTRY_CONFIGS.US.id)).toBe("US");
    expect(getBankId(COUNTRY_CONFIGS.UK.id)).toBe("UK");
    expect(getBankId(COUNTRY_CONFIGS.JP.id)).toBe("JP");
  });
});

describe("getRepresentativeCentralBankCountry", () => {
  it("resolves a shared bank from country config instead of org founding members", () => {
    expect(getRepresentativeCentralBankCountry("EU")).toBe("DE");
  });
});

describe("buildPrimeRateByCountry", () => {
  it("resolves DE via ECB and IE via its own bank doc", () => {
    const banks = [
      { _id: "US", countryId: "US", primeRate: 1.25 },
      { _id: "ECB", countryId: "DE", primeRate: 5.0 },
      { _id: "IE", countryId: "IE", primeRate: 4.0 },
    ];
    const map = buildPrimeRateByCountry(banks as never);
    expect(map.get("US")).toBe(1.25);
    expect(map.get("DE")).toBe(5.0);
    expect(map.get("IE")).toBe(4.0);
  });

  it("keeps docs for countries outside COUNTRY_ORDER resolvable under their own countryId", () => {
    const banks = [{ _id: "ZZ", countryId: "ZZ", primeRate: 7.5 }];
    const map = buildPrimeRateByCountry(banks as never);
    expect(map.get("ZZ" as never)).toBe(7.5);
  });

  it("skips non-finite prime rates so consumers fall back to configured defaults", () => {
    const banks = [{ _id: "US", countryId: "US", primeRate: Number.NaN }];
    const map = buildPrimeRateByCountry(banks as never);
    expect(map.has("US")).toBe(false);
  });
});

describe("getCentralBankScope", () => {
  it("filters org memberships down to the countries wired to the shared bank", async () => {
    const db = createMockDb();
    const membershipCursor = {
      project: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ countryId: "DE" }, { countryId: "IE" }, { countryId: "UK" }]),
      }),
    };
    db.collectionMocks.organizationMemberships = {
      ...db.collection("organizationMemberships"),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue(membershipCursor),
    };

    const scope = await getCentralBankScope(db as unknown as Db, "DE");

    expect(scope.bankId).toBe("ECB");
    expect(scope.intorgId).toBe("EU");
    // IE no longer shares the ECB — only DE is wired to the euro bank.
    expect(scope.memberCountries).toEqual(["DE"]);
  });

  it("scopes IE to its own Central Bank of Ireland", async () => {
    const db = createMockDb();
    const scope = await getCentralBankScope(db as unknown as Db, "IE");
    expect(scope.bankId).toBe("IE");
    expect(scope.intorgId).toBeUndefined();
    expect(scope.memberCountries).toEqual(["IE"]);
  });
});
