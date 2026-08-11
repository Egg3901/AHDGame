import { describe, it, expect } from "vitest";
import { countryHasPresidentialRunningMate } from "./runningMateEligibility";

describe("countryHasPresidentialRunningMate", () => {
  it("is true for countries whose president runs on a VP ticket", () => {
    // US, Brazil, and Nigeria all define a `vicePresident` office — the
    // president is elected alongside a running mate.
    expect(countryHasPresidentialRunningMate("US")).toBe(true);
    expect(countryHasPresidentialRunningMate("BR")).toBe(true);
    expect(countryHasPresidentialRunningMate("NG")).toBe(true);
  });

  it("is false for ceremonial / no-VP presidencies", () => {
    // Ireland's Uachtarán and China's President have no `vicePresident`
    // running-mate office, so the selector must not appear.
    expect(countryHasPresidentialRunningMate("IE")).toBe(false);
    expect(countryHasPresidentialRunningMate("CN")).toBe(false);
  });
});
