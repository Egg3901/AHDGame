import { describe, expect, it } from "vitest";
import { getParliamentaryCountryIds } from "./parliamentaryGovernment";
import { getHeadOfGovernmentOfficeKey } from "@/lib/constants/countries";

describe("era-aware parliamentary government coverage", () => {
  it("includes Fourth Republic France in the 1953 government loop", () => {
    expect(getParliamentaryCountryIds("1953-default")).toContain("FR");
  });

  it("does not classify Fifth Republic France as parliamentary in 1979", () => {
    expect(getParliamentaryCountryIds("1979-default")).not.toContain("FR");
  });

  it("runs Romanian parliamentary PM formation without confusing the elected presidency", () => {
    expect(getParliamentaryCountryIds("2027-default")).toContain("RO");
    expect(getHeadOfGovernmentOfficeKey("RO", "2027-default")).toBe("primeMinister");
    expect(getParliamentaryCountryIds("2027-default")).not.toContain("RU");
    expect(getParliamentaryCountryIds("1979-default")).toContain("RO");
  });
});
