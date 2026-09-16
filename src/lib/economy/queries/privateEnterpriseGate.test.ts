import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { COMMAND_CEILING } from "@/lib/constants/commandEconomy";
import type { CountryId } from "@/lib/constants/countries";
import { stubMarketizationDb as stubDb } from "@/lib/test-utils/stubMarketizationDb";
import {
  assertPrivateEnterprisePermitted,
  isPrivateEnterpriseBlocked,
  isPrivateEnterprisePermittedAtLevel,
  loadPrivateEnterpriseBlockedCountries,
  PrivateEnterpriseBlockedError,
  privateEnterpriseBlockedByYear,
} from "./privateEnterpriseGate";

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

  it("IGNORES a stray persisted level on an unscheduled market economy", async () => {
    // Caught in the branch audit. Live prod carries
    // DE.economicFactors.marketizationLevel = 0.0919 - noise from an unrelated
    // write. Reading it for every country (rather than only for countries that
    // carry a marketization trajectory) closed West Germany to private
    // enterprise outright. The old gate was immune by accident because it only
    // considered scheduled countries; this pins that behaviour deliberately.
    const blocked = await loadPrivateEnterpriseBlockedCountries(
      stubDb({ currentYear: 1970, levels: { DE: 0.09199919567338562 } })
    );
    expect(blocked.has("DE")).toBe(false);
  });

  it("ignores a stray persisted level on every unscheduled country", async () => {
    const blocked = await loadPrivateEnterpriseBlockedCountries(
      stubDb({ currentYear: 1970, levels: { US: 0, UK: 1, JP: 2, FR: 0, IT: 5 } })
    );
    for (const id of ["US", "UK", "JP", "FR", "IT"]) {
      expect(blocked.has(id as CountryId), id).toBe(false);
    }
  });

  it("matches persisted rows by budget id, not country id", async () => {
    // Guards the getNationalBudgetId mapping: RU's persisted 55 must be found
    // and must release it, proving the row was matched rather than missed (a
    // missed row would silently fall back to the schedule and still block).
    const blocked = await loadPrivateEnterpriseBlockedCountries(
      stubDb({ currentYear: 1970, levels: { RU: 55 } })
    );
    expect(blocked.has("RU")).toBe(false);
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

describe("isPrivateEnterpriseBlocked", () => {
  it("reports blocked for a fully command country", async () => {
    await expect(isPrivateEnterpriseBlocked(stubDb({ currentYear: 1970 }), "RU")).resolves.toBe(
      true
    );
  });

  it("reports permitted for a market economy", async () => {
    await expect(isPrivateEnterpriseBlocked(stubDb({ currentYear: 1970 }), "US")).resolves.toBe(
      false
    );
  });

  it("fails CLOSED when the lookup throws", async () => {
    const db = {
      collection: () => {
        throw new Error("db down");
      },
    } as unknown as Db;
    await expect(isPrivateEnterpriseBlocked(db, "US")).resolves.toBe(true);
  });
});
