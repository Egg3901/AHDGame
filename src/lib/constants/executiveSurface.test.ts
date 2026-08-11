import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getExecutiveSurface, termClockBadge } from "./executiveSurface";

const ALL_COUNTRIES = Object.keys(COUNTRY_CONFIGS) as CountryId[];

describe("getExecutiveSurface", () => {
  it("provides a complete surface config for every country", () => {
    for (const countryId of ALL_COUNTRIES) {
      const surface = getExecutiveSurface(countryId);
      expect(surface.clock.label.length).toBeGreaterThan(0);
      expect(surface.heroImage).toMatch(/^\/api\/images\/hero\//);
      expect(surface.actLabels.signed.length).toBeGreaterThan(0);
      expect(surface.rosterTitle.length).toBeGreaterThan(0);
    }
  });

  it("gives the US an election term clock and a bills desk", () => {
    const us = getExecutiveSurface("US");
    expect(us.clock.kind).toBe("election");
    expect(us.deskKind).toBe("bills");
  });

  it("gives CN a plenum clock, directive desk, and State Council roster", () => {
    const cn = getExecutiveSurface("CN");
    expect(cn.clock.kind).toBe("plenum");
    expect(cn.deskKind).toBe("orders");
    expect(cn.rosterTitle).toBe("State Council");
    expect(cn.actLabels.signed).toBe("ENACTED");
    expect(cn.actLabels.order).toBe("DIRECTIVE");
  });

  it("parliamentary countries get election clocks", () => {
    for (const countryId of ["UK", "DE", "JP", "IE"] as CountryId[]) {
      expect(getExecutiveSurface(countryId).clock.kind).toBe("election");
    }
  });
});

describe("termClockBadge", () => {
  it("renders TERM n OF limit with re-run eligibility before the final term", () => {
    expect(termClockBadge(2, 1)).toEqual({
      badge: "TERM 1 OF 2",
      subline: "eligible to run again",
    });
  });

  it("flips the subline in the final term", () => {
    expect(termClockBadge(2, 2)).toEqual({
      badge: "TERM 2 OF 2",
      subline: "term-limited — cannot run again",
    });
  });

  it("returns null without a term limit or without a known current term", () => {
    expect(termClockBadge(undefined, 1)).toBeNull();
    expect(termClockBadge(2, undefined)).toBeNull();
  });
});
