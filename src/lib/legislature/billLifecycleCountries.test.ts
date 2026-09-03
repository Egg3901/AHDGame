import { describe, expect, it } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { BILL_LIFECYCLE_COUNTRY_IDS } from "./billLifecycleCountries";
import { hasBillLifecycle as hasBillLifecycleLive } from "./hasBillLifecycle";
import { COUNTRY_BILL_PHASES } from "@/lib/turn/countryPhases";

/**
 * The static lifecycle list must stay in lockstep with the real
 * `COUNTRY_BILL_PHASES` table. The static copy exists so read models do not
 * drag the turn engine (and its seed budgets) into their module graph; this
 * contract is what makes that split safe.
 */
describe("billLifecycleCountries contract", () => {
  it("matches the COUNTRY_BILL_PHASES table exactly (plus the US)", () => {
    const fromTable = new Set<string>(Object.keys(COUNTRY_BILL_PHASES));
    fromTable.add("US");
    expect([...fromTable].sort()).toEqual([...BILL_LIFECYCLE_COUNTRY_IDS].sort());
  });

  it("answers identically to the table-backed helper for every country id", () => {
    for (const countryId of BILL_LIFECYCLE_COUNTRY_IDS) {
      expect(hasBillLifecycleLive(countryId as CountryId)).toBe(true);
    }
  });
});
