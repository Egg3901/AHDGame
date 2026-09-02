import { describe, it, expect } from "vitest";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { BILL_LIFECYCLE_COUNTRY_IDS } from "@/lib/legislature/billLifecycleCountries";
import { COUNTRY_BILL_PHASES } from "@/lib/turn/countryPhases";
import type { CountryId } from "@/lib/constants/countries";

describe("hasBillLifecycle", () => {
  it("includes the United States", () => {
    // ⚠️ The discriminating half. US is NOT a key of COUNTRY_BILL_PHASES — its engine runs from billLifecycle.ts. A bare table lookup skips the
    // feature's most important belligerent, and the France assertion below passes
    // anyway, so without THIS test the feature ships broken for the US.
    expect(hasBillLifecycle("US")).toBe(true);
    expect(COUNTRY_BILL_PHASES.US).toBeUndefined();
  });

  it("includes a COUNTRY_BILL_PHASES country", () => {
    expect(hasBillLifecycle("UK")).toBe(true);
  });

  it("includes every country in the table, so a new entry needs no second edit", () => {
    for (const countryId of Object.keys(COUNTRY_BILL_PHASES)) {
      expect(hasBillLifecycle(countryId as never), countryId).toBe(true);
    }
  });

  it("says NO to every country the table does not walk", () => {
    // The other direction, and the dangerous one. `hasBillLifecycle` reads an id
    // set rather than the operational table, because the table binds a runner
    // per country and importing it drags the whole turn engine behind every
    // caller (ticket #1257 broke five test files that way). The set is only safe
    // while it matches: an id in it that no engine walks mints bills that never
    // close, and the table-side test above cannot see that.
    const fromTable = new Set<CountryId>([
      ...(Object.keys(COUNTRY_BILL_PHASES) as CountryId[]),
      "US",
    ]);
    expect([...BILL_LIFECYCLE_COUNTRY_IDS].sort()).toEqual([...fromTable].sort());
    expect(hasBillLifecycle("JO" as CountryId)).toBe(false);
  });

  it("includes every econ-only country that can mint national bills", () => {
    // A bill minted for a country no engine walks never closes. This list is the
    // regression boundary for the countries that previously stranded NPP bills.
    for (const countryId of ["FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR", "BR", "NG"] as const) {
      expect(hasBillLifecycle(countryId), countryId).toBe(true);
    }
  });
});
