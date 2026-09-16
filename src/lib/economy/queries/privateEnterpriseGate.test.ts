import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { COMMAND_CEILING } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";
import {
  assertPrivateEnterprisePermitted,
  isPrivateEnterprisePermittedAtLevel,
  loadPrivateEnterpriseBlockedCountries,
  PrivateEnterpriseBlockedError,
  privateEnterpriseBlockedByYear,
} from "./privateEnterpriseGate";

/**
 * Minimal `Db` stub covering exactly the two reads the gate performs. Countries
 * absent from `levels` return no budget row, so the schedule fallback is
 * exercised in the same test rather than needing a separate fixture.
 */
export function stubDb(opts: {
  currentYear: number | null;
  levels?: Partial<Record<CountryId, number>>;
}): Db {
  const rows = Object.entries(opts.levels ?? {}).map(([id, level]) => ({
    _id: getNationalBudgetId(id as CountryId),
    economicFactors: { marketizationLevel: level },
  }));
  return {
    collection(name: string) {
      if (name === "gameState") {
        return { findOne: async () => ({ _id: "current", currentYear: opts.currentYear }) };
      }
      if (name === "federalBudget") {
        return { find: () => ({ toArray: async () => rows }) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
}

const FULLY_COMMAND_IN_1970 = ["RU", "DD", "PL", "HU", "CS", "BG", "RO", "BLR", "UKR", "BAL", "CN"];

describe("isPrivateEnterprisePermittedAtLevel", () => {
  it("blocks below the command ceiling and permits at or above it", () => {
    expect(isPrivateEnterprisePermittedAtLevel(0)).toBe(false);
    expect(isPrivateEnterprisePermittedAtLevel(COMMAND_CEILING - 0.01)).toBe(false);
    expect(isPrivateEnterprisePermittedAtLevel(COMMAND_CEILING)).toBe(true);
    expect(isPrivateEnterprisePermittedAtLevel(100)).toBe(true);
  });
});

describe("privateEnterpriseBlockedByYear (schedule only)", () => {
  it("blocks the whole bloc AND China in 1970", () => {
    for (const id of FULLY_COMMAND_IN_1970) {
      expect(privateEnterpriseBlockedByYear(id, 1970), id).toBe(true);
    }
  });

  it("covers BLR, UKR and BAL with no country-config flag - closes L9 for free", () => {
    for (const id of ["BLR", "UKR", "BAL"]) {
      expect(privateEnterpriseBlockedByYear(id, 1970), id).toBe(true);
    }
  });

  it("permits YU in 1970 - post-1965 market socialism sits above the ceiling", () => {
    expect(privateEnterpriseBlockedByYear("YU", 1970)).toBe(false);
  });

  it("blocks YU in 1960, when it was still plan-directed", () => {
    expect(privateEnterpriseBlockedByYear("YU", 1960)).toBe(true);
  });

  it("RELEASES China once it reaches the dual-track era", () => {
    expect(privateEnterpriseBlockedByYear("CN", 1978)).toBe(true);
    expect(privateEnterpriseBlockedByYear("CN", 1985)).toBe(false);
  });

  it("RELEASES the Soviet bloc after its schedule terminus", () => {
    expect(privateEnterpriseBlockedByYear("RU", 1991)).toBe(true);
    expect(privateEnterpriseBlockedByYear("RU", 1992)).toBe(false);
    expect(privateEnterpriseBlockedByYear("DD", 1990)).toBe(true);
    expect(privateEnterpriseBlockedByYear("DD", 1991)).toBe(false);
  });

  it("permits market economies and unknown ids in every year", () => {
    for (const id of ["US", "UK", "DE", "JP", "FI", "ZZ"]) {
      expect(privateEnterpriseBlockedByYear(id, 1970), id).toBe(false);
    }
  });

  it("permits rather than throws on a null country or year", () => {
    expect(privateEnterpriseBlockedByYear(null, 1970)).toBe(false);
    expect(privateEnterpriseBlockedByYear("RU", null)).toBe(false);
  });
});

describe("loadPrivateEnterpriseBlockedCountries", () => {
  it("blocks every fully-command country from the schedule alone", async () => {
    const blocked = await loadPrivateEnterpriseBlockedCountries(stubDb({ currentYear: 1970 }));
    for (const id of FULLY_COMMAND_IN_1970) {
      expect(blocked.has(id as CountryId), id).toBe(true);
    }
    expect(blocked.has("US")).toBe(false);
    expect(blocked.has("YU")).toBe(false);
  });

  it("prefers the PERSISTED level over the schedule", async () => {
    // YU's schedule says 35 in 1970; persist 12 and it must block.
    const blocked = await loadPrivateEnterpriseBlockedCountries(
      stubDb({ currentYear: 1970, levels: { YU: 12 } })
    );
    expect(blocked.has("YU")).toBe(true);
  });

  it("releases a country whose persisted level has drifted above the ceiling", async () => {
    const blocked = await loadPrivateEnterpriseBlockedCountries(
      stubDb({ currentYear: 1970, levels: { RU: 55 } })
    );
    expect(blocked.has("RU")).toBe(false);
  });

  it("ignores a non-finite persisted level and falls back to the schedule", async () => {
    const blocked = await loadPrivateEnterpriseBlockedCountries(
      stubDb({ currentYear: 1970, levels: { RU: Number.NaN } })
    );
    expect(blocked.has("RU")).toBe(true);
  });

  it("resolves the US through its legacy 'federal' budget id", async () => {
    // Guards the getNationalBudgetId special case: a persisted command-level US
    // must actually block, proving the row was matched rather than missed.
    const blocked = await loadPrivateEnterpriseBlockedCountries(
      stubDb({ currentYear: 1970, levels: { US: 5 } })
    );
    expect(blocked.has("US")).toBe(true);
  });
});

describe("assertPrivateEnterprisePermitted", () => {
  it("throws for a fully command country", async () => {
    await expect(
      assertPrivateEnterprisePermitted(stubDb({ currentYear: 1970 }), "RU")
    ).rejects.toBeInstanceOf(PrivateEnterpriseBlockedError);
  });

  it("resolves for a market economy", async () => {
    await expect(
      assertPrivateEnterprisePermitted(stubDb({ currentYear: 1970 }), "US")
    ).resolves.toBeUndefined();
  });

  it("fails CLOSED when the lookup throws", async () => {
    const db = {
      collection: () => {
        throw new Error("db down");
      },
    } as unknown as Db;
    await expect(assertPrivateEnterprisePermitted(db, "US")).rejects.toBeInstanceOf(
      PrivateEnterpriseBlockedError
    );
  });

  it("carries the country id on the error for callers that map it to a response", async () => {
    await expect(
      assertPrivateEnterprisePermitted(stubDb({ currentYear: 1970 }), "RU")
    ).rejects.toMatchObject({ countryId: "RU" });
  });
});
