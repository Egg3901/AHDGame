import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import {
  chargeOrganizationDues,
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

/**
 * Ticket #1156 follow-up, caught in the branch audit. A member with no
 * `federalBudget` row matches nothing on the debit, and the fund used to be
 * credited anyway — money from nowhere. Unreachable while dues were restricted
 * to player-enabled countries, which all hold a treasury; reachable the moment
 * non-voting members began paying dues in organisations that levy no tribute.
 */
describe("chargeOrganizationDues — credits only what it debited", () => {
  /** Mock db in which only `withTreasury` countries hold a federalBudget row. */
  function duesDb(withTreasury: string[]) {
    const debits: Array<{ countryId: string; delta: number }> = [];
    let fundBalance = 0;
    const collection = (name: string) => {
      if (name === "federalBudget") {
        return {
          updateOne: async (
            filter: { countryId: string },
            update: { $inc?: { treasuryBalance?: number } }
          ) => {
            if (!withTreasury.includes(filter.countryId)) {
              return { matchedCount: 0, modifiedCount: 0 };
            }
            debits.push({ countryId: filter.countryId, delta: update.$inc?.treasuryBalance ?? 0 });
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "gameState") {
        return { findOne: async () => ({ _id: "current", preset: "2019-default" }) };
      }
      return {
        findOne: async () => null,
        updateOne: async (_f: unknown, update: { $inc?: { balanceLocal?: number } }) => {
          fundBalance += update.$inc?.balanceLocal ?? 0;
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    };
    return {
      db: { collection } as unknown as Db,
      debits,
      fund: () => fundBalance,
    };
  }

  const members = [
    { countryId: "US" as const, gdpUsd: 20_000_000_000_000 },
    { countryId: "JP" as const, gdpUsd: 5_000_000_000_000 },
  ];

  it("skips a member with no treasury instead of minting its contribution", async () => {
    const onlyUs = duesDb(["US"]);
    await chargeOrganizationDues(onlyUs.db, "UN", members);
    expect(onlyUs.debits.map((d) => d.countryId)).toEqual(["US"]);
    expect(onlyUs.debits[0].delta).toBeLessThan(0);

    // The same roll where both hold a treasury raises strictly more, which is
    // the amount the old code was inventing for the unmodelled member.
    const both = duesDb(["US", "JP"]);
    await chargeOrganizationDues(both.db, "UN", members);
    expect(both.fund()).toBeGreaterThan(onlyUs.fund());
  });

  it("credits nothing at all when no member holds a treasury", async () => {
    const none = duesDb([]);
    await chargeOrganizationDues(none.db, "UN", members);
    expect(none.debits).toEqual([]);
    expect(none.fund()).toBe(0);
  });
});
