import { describe, it, expect } from "vitest";
import { hasBillLifecycle } from "@/lib/legislature/hasBillLifecycle";
import { COUNTRY_BILL_PHASES } from "@/lib/turn/countryPhases";

describe("hasBillLifecycle", () => {
  it("includes the United States", () => {
    // ⚠️ The discriminating half. COUNTRY_BILL_PHASES has 16 keys and US is NOT one
    // of them — its engine runs from billLifecycle.ts. A bare table lookup skips the
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

  it("includes every econ-only country that can mint national bills", () => {
    // A bill minted for a country no engine walks never closes. This list is the
    // regression boundary for the countries that previously stranded NPP bills.
    for (const countryId of ["FR", "IT", "ES", "SE", "TR", "AT", "FI", "GR", "BR", "NG"] as const) {
      expect(hasBillLifecycle(countryId), countryId).toBe(true);
    }
  });
});
