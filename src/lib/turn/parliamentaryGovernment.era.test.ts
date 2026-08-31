import { describe, expect, it } from "vitest";
import { getParliamentaryCountryIds } from "./parliamentaryGovernment";

describe("era-aware parliamentary government coverage", () => {
  it("includes Fourth Republic France in the 1953 government loop", () => {
    expect(getParliamentaryCountryIds("1953-default")).toContain("FR");
  });

  it("does not classify Fifth Republic France as parliamentary in 1979", () => {
    expect(getParliamentaryCountryIds("1979-default")).not.toContain("FR");
  });
});
