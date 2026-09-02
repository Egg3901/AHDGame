import { describe, expect, it } from "vitest";
import { BILL_LIFECYCLE_COUNTRY_IDS } from "./billLifecycleCountries";
import { hasBillLifecycle } from "./hasBillLifecycle";
import { COUNTRY_BILL_PHASES } from "@/lib/turn/countryPhases";
import type { CountryId } from "@/lib/constants/countries";

/**
 * The id set exists so callers can ask which countries have a lifecycle without
 * importing the operational table, whose entries bind runner functions and drag
 * the whole turn engine (and the world seed builders behind it) along. That is
 * only safe while the two agree, so this is the test that keeps them agreeing.
 */
describe("bill lifecycle country ids", () => {
  it("matches the operational phase table exactly, plus the US", () => {
    const fromTable = new Set<CountryId>([
      ...(Object.keys(COUNTRY_BILL_PHASES) as CountryId[]),
      "US",
    ]);
    expect([...BILL_LIFECYCLE_COUNTRY_IDS].sort()).toEqual([...fromTable].sort());
  });

  it("answers for the US, which the table itself does not list", () => {
    // The discriminating case: the US lifecycle is invoked directly from
    // billLifecycle.ts, so a bare table lookup drops the biggest legislature.
    expect("US" in COUNTRY_BILL_PHASES).toBe(false);
    expect(hasBillLifecycle("US")).toBe(true);
  });

  it("says no to a country no engine walks", () => {
    expect(hasBillLifecycle("JO" as CountryId)).toBe(false);
  });
});
