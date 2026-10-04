import { describe, expect, it } from "vitest";
import {
  bankingSeparationDefault,
  bankingWorldYear,
  playerInvestmentBankingSeedFlags,
} from "./charterAccess";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

describe("1991 charter access", () => {
  it("preserves US separation until the live year crosses 1999", () => {
    expect(bankingSeparationDefault({ countryId: "US", year: 1991, eraUnitScale: 1 })).toBe(
      "separated"
    );
    expect(bankingSeparationDefault({ countryId: "US", year: 1998, eraUnitScale: 1 })).toBe(
      "separated"
    );
    expect(bankingSeparationDefault({ countryId: "US", year: 1999, eraUnitScale: 1953 })).toBe(
      "universal"
    );
  });
  it("derives legacy years from the live turn rather than freezing the seed year", () => {
    expect(bankingWorldYear({ preset: "1991-default", currentTurn: TURNS_PER_YEAR * 8 + 1 })).toBe(
      1999
    );
    expect(bankingWorldYear({ preset: "1991-default", currentTurn: 1 })).toBe(1991);
    expect(bankingWorldYear({ preset: "1991-default", currentYear: 2001, currentTurn: 1 })).toBe(
      2001
    );
    expect(bankingWorldYear(null)).toBeNull();
  });
  it("retains other nations' era defaults", () => {
    expect(bankingSeparationDefault({ countryId: "UK", year: 1991, eraUnitScale: 1 })).toBe(
      "universal"
    );
    expect(bankingSeparationDefault({ countryId: "JP", year: 1953, eraUnitScale: 20 })).toBe(
      "separated"
    );
  });
  it("initializes only the approved 1991 seed's access and fee flags", () => {
    expect(playerInvestmentBankingSeedFlags(1991)).toEqual({
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
      playerAdvancedBankChartersEnabled: true,
      bankPropForexFeesEnabled: true,
    });
    expect(playerInvestmentBankingSeedFlags(2019)).toEqual({});
    expect(playerInvestmentBankingSeedFlags(1953)).toEqual({});
  });
});
