import { describe, expect, it } from "vitest";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { genericUnionName, getUnionName } from "@/lib/unions/unionNames";

describe("getUnionName", () => {
  it("returns a historical US auto union for 2019", () => {
    expect(getUnionName("US", "automobiles", "2019-default")).toBe("United Auto Workers");
  });

  it("returns era-appropriate UK mining union for 1953", () => {
    expect(getUnionName("UK", "extraction", "1953-default")).toBe("National Union of Mineworkers");
  });

  it("returns pre-merger DE chemical union for 1953", () => {
    expect(getUnionName("DE", "chemical_industries", "1953-default")).toBe(
      "IG Chemie-Papier-Keramik"
    );
  });

  it("returns modern DE chemical union for 2019", () => {
    expect(getUnionName("DE", "chemical_industries", "2019-default")).toBe("IG BCE");
  });

  it("returns Soviet-era federation name for RU in 1979", () => {
    expect(getUnionName("RU", "manufacturing", "1979-default")).toBe(
      "All-Union Central Council of Trade Unions"
    );
  });

  it("falls back to generic name for sectors without a historical entry", () => {
    expect(getUnionName("US", "financial", "2019-default")).toBe(
      genericUnionName("US", "financial")
    );
  });

  it("falls back to generic name for countries without authored names", () => {
    const country = "SCO" as CountryId;
    const sector = "manufacturing" as CorporationType;
    expect(getUnionName(country, sector, "2019-default")).toBe(genericUnionName(country, sector));
  });

  // Historical-accuracy regressions (union-name audit): the seeds must not
  // reference bodies that did not exist yet in the preset's starting year.
  describe("era anachronism guards", () => {
    it("Poland 1979 predates Solidarity (founded August 1980)", () => {
      expect(getUnionName("PL", "extraction", "1979-default")).toBe(
        "Central Council of Trade Unions"
      );
    });

    it("Poland 1991 has Solidarity", () => {
      expect(getUnionName("PL", "extraction", "1991-default")).toBe("NSZZ Solidarność");
    });

    it("US 1953 predates the 1955 OCAW merger", () => {
      expect(getUnionName("US", "chemical_industries", "1953-default")).toBe(
        "Oil Workers International Union"
      );
    });

    it("US 1979 predates the mid-1979 UFCW merger", () => {
      expect(getUnionName("US", "retail", "1979-default")).toBe(
        "Retail Clerks International Association"
      );
    });

    it("UK 1991 predates the CWU (formed 1995)", () => {
      expect(getUnionName("UK", "telecommunications", "1991-default")).toBe(
        "National Communications Union"
      );
    });

    it("USSR 1991 uses the post-October-1990 successor confederation", () => {
      expect(getUnionName("RU", "manufacturing", "1991-default")).toBe(
        "General Confederation of Trade Unions"
      );
    });

    it("Franco-era Spain 1953 has only the state vertical syndicate", () => {
      expect(getUnionName("ES", "manufacturing", "1953-default")).toBe(
        "Organización Sindical Española"
      );
    });

    it("Japan 1953 predates the 1972 auto workers' confederation", () => {
      expect(getUnionName("JP", "automobiles", "1953-default")).toBe(
        "All Japan Automobile Industry Workers' Union"
      );
    });

    it("Hungary 1979 uses SZOT, 1991 uses MSZOSZ", () => {
      expect(getUnionName("HU", "manufacturing", "1979-default")).toBe(
        "National Council of Trade Unions"
      );
      expect(getUnionName("HU", "manufacturing", "1991-default")).toBe(
        "National Confederation of Hungarian Trade Unions"
      );
    });

    it("Brazil 1979 predates the CUT (founded 1983)", () => {
      expect(getUnionName("BR", "manufacturing", "1979-default")).toBe(
        "National Confederation of Industrial Workers"
      );
    });

    it("Ireland 1979 predates SIPTU (formed 1990)", () => {
      expect(getUnionName("IE", "manufacturing", "1979-default")).toBe(
        "Irish Transport and General Workers' Union"
      );
    });

    it("US 1999 predates SAG-AFTRA (2012) and NNU (2009)", () => {
      expect(getUnionName("US", "entertainment", "1999-default")).toBe("Screen Actors Guild");
      expect(getUnionName("US", "healthcare", "1999-default")).toBe(
        "Service Employees International Union"
      );
    });
  });
});

describe("genericUnionName", () => {
  it("formats country and sector labels", () => {
    expect(genericUnionName("US", "manufacturing")).toBe(
      "United States Manufacturing Workers' Union"
    );
  });
});
