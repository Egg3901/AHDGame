import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import {
  clampDuesRate,
  disburseFromOrganizationFund,
  getOrganizationFund,
  localToUsd,
  memberDueUsd,
} from "./organizationFund";
import {
  DEFAULT_ORG_DUES_RATE_ANNUAL,
  MAX_ORG_DUES_RATE_ANNUAL,
} from "@/lib/constants/internationalOrganizations";

describe("localToUsd", () => {
  it("converts local currency to USD via usdExchangeRate (US = 1.0)", () => {
    expect(localToUsd("US", 1_000_000)).toBe(1_000_000);
  });
  it("scales a weak currency down (JP rate < 1)", () => {
    expect(localToUsd("JP", 1_000_000)).toBeLessThan(1_000_000);
    expect(localToUsd("JP", 1_000_000)).toBeGreaterThan(0);
  });
  it("returns 0 for non-positive amounts", () => {
    expect(localToUsd("US", 0)).toBe(0);
    expect(localToUsd("US", -5)).toBe(0);
  });
});

describe("memberDueUsd", () => {
  it("prorates the annual rate across a year of turns", () => {
    // 48M GDP × 0.00006 / 48 turns = 60 USD/turn.
    expect(memberDueUsd(48_000_000, 0.00006)).toBeCloseTo(60, 6);
  });
  it("is zero for non-positive GDP or rate", () => {
    expect(memberDueUsd(0, 0.00006)).toBe(0);
    expect(memberDueUsd(1_000, 0)).toBe(0);
  });
});

describe("clampDuesRate", () => {
  it("clamps to the allowed band", () => {
    expect(clampDuesRate(-1)).toBe(0);
    expect(clampDuesRate(5)).toBe(MAX_ORG_DUES_RATE_ANNUAL);
    expect(clampDuesRate(0.0001)).toBe(0.0001);
    expect(clampDuesRate(Number.NaN)).toBe(DEFAULT_ORG_DUES_RATE_ANNUAL);
  });
});

/** Stateful fake `organizationFunds` collection (fund-currency balance). */
function fundDb(initialBalance: number): Db {
  const row = {
    organizationId: "EU",
    balanceLocal: initialBalance,
    currencyCountryId: "DE",
    duesRateAnnual: 0.00006,
  };
  const col = {
    async findOne() {
      return row;
    },
    async updateOne(
      filter: { balanceLocal?: { $gte: number } },
      update: { $inc?: { balanceLocal?: number } }
    ) {
      if (filter.balanceLocal && row.balanceLocal < filter.balanceLocal.$gte) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      row.balanceLocal += update.$inc?.balanceLocal ?? 0;
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  return { collection: () => col } as unknown as Db;
}

describe("disburseFromOrganizationFund", () => {
  it("pays out when the balance covers it", async () => {
    const db = fundDb(1000);
    expect(await disburseFromOrganizationFund(db, "EU", 600)).toBe(true);
    expect((await getOrganizationFund(db, "EU")).balanceLocal).toBe(400);
  });
  it("refuses when underfunded and leaves the balance intact", async () => {
    const db = fundDb(500);
    expect(await disburseFromOrganizationFund(db, "EU", 600)).toBe(false);
    expect((await getOrganizationFund(db, "EU")).balanceLocal).toBe(500);
  });
});
