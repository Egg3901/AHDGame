import { describe, expect, it } from "vitest";
import { resolveTabs } from "./RegionTabNav";
import { regionElectionsUrl } from "@/lib/urls";

describe("regionElectionsUrl ↔ resolveTabs contract", () => {
  // The nav's State Elections link builds its href from regionElectionsUrl,
  // and this resolver decides which tab that href actually opens. They live in
  // different files, so without this test a rename of either the `tab`/`sub`
  // param names or the "elections" sub-tab id would silently land the link on
  // Politics > Officials instead, with nothing failing.
  it("lands the nav's State Elections href on the Elections sub-tab", () => {
    const url = new URL(regionElectionsUrl("US", "NY"), "https://example.test");
    const params = url.searchParams;

    expect(url.pathname).toBe("/country/us/region/NY");
    expect(resolveTabs(params.get("tab"), params.get("sub"), false)).toEqual({
      superTab: "politics",
      subTab: "elections",
    });
  });
});

describe("resolveTabs", () => {
  describe("sub-tab switching (regression: legacy map was shadowing the sub param)", () => {
    it("resolves Economy's Budget and Resources sub-tabs, not just the default Sectors", () => {
      expect(resolveTabs("economy", "budget", false)).toEqual({
        superTab: "economy",
        subTab: "budget",
      });
      expect(resolveTabs("economy", "resources", false)).toEqual({
        superTab: "economy",
        subTab: "resources",
      });
    });

    it("resolves Politics' Parties and Elections sub-tabs, not just the default Officials", () => {
      expect(resolveTabs("politics", "parties", false)).toEqual({
        superTab: "politics",
        subTab: "parties",
      });
      expect(resolveTabs("politics", "elections", false)).toEqual({
        superTab: "politics",
        subTab: "elections",
      });
    });

    it("resolves Demographics' Statistics sub-tab, not just the default Demographics", () => {
      expect(resolveTabs("demographics", "statistics", false)).toEqual({
        superTab: "demographics",
        subTab: "statistics",
      });
    });
  });

  describe("the political registry is its own super-tab", () => {
    // The registry moved out of Demographics, and the legacy boards it used to
    // sit beside stayed behind under the new "statistics" id. Both halves of
    // that swap are pinned here: a regression in either one silently strands a
    // bookmark on the wrong metrics system.
    it("resolves the Metrics super-tab", () => {
      expect(resolveTabs("metrics", null, false)).toEqual({ superTab: "metrics", subTab: "" });
    });

    it("ignores a stray sub param on the single-panel Metrics tab", () => {
      expect(resolveTabs("metrics", "anything", false)).toEqual({
        superTab: "metrics",
        subTab: "",
      });
    });

    it("resolves a bare ?tab=statistics onto Demographics", () => {
      expect(resolveTabs("statistics", null, false)).toEqual({
        superTab: "demographics",
        subTab: "statistics",
      });
    });
  });

  describe("countries with no registry never reach the Metrics tab", () => {
    // Only the four board countries have a registry. Every other country still
    // gets a region page, so without this gate the promotion would hand ~22
    // countries a prominent top-level tab whose endpoint 404s.
    it("sends ?tab=metrics to the statistics boards instead", () => {
      expect(resolveTabs("metrics", null, false, false)).toEqual({
        superTab: "demographics",
        subTab: "statistics",
      });
    });

    it("sends ?tab=metrics&sub=anything there too", () => {
      expect(resolveTabs("metrics", "whatever", false, false)).toEqual({
        superTab: "demographics",
        subTab: "statistics",
      });
    });

    it("leaves every other tab untouched", () => {
      expect(resolveTabs("economy", "budget", false, false)).toEqual({
        superTab: "economy",
        subTab: "budget",
      });
      expect(resolveTabs("demographics", "statistics", false, false)).toEqual({
        superTab: "demographics",
        subTab: "statistics",
      });
    });

    it("defaults to the registry when the flag is omitted, matching board countries", () => {
      expect(resolveTabs("metrics", null, false)).toEqual({ superTab: "metrics", subTab: "" });
    });
  });

  describe("old single-param bookmarks still resolve the same as before", () => {
    it("?tab=politics with no sub defaults to officials", () => {
      expect(resolveTabs("politics", null, false)).toEqual({
        superTab: "politics",
        subTab: "officials",
      });
    });

    it("?tab=economy with no sub defaults to sectors", () => {
      expect(resolveTabs("economy", null, false)).toEqual({
        superTab: "economy",
        subTab: "sectors",
      });
    });

    it("?tab=demographics with no sub defaults to demographics", () => {
      expect(resolveTabs("demographics", null, false)).toEqual({
        superTab: "demographics",
        subTab: "demographics",
      });
    });

    it("legacy-only keys (no matching current super-tab id) still map through", () => {
      expect(resolveTabs("elections", null, false)).toEqual({
        superTab: "politics",
        subTab: "elections",
      });
      expect(resolveTabs("parties", null, false)).toEqual({
        superTab: "politics",
        subTab: "parties",
      });
      expect(resolveTabs("budget", null, false)).toEqual({
        superTab: "economy",
        subTab: "budget",
      });
      expect(resolveTabs("laws", null, false)).toEqual({
        superTab: "governance",
        subTab: "laws",
      });
      expect(resolveTabs("resources", null, false)).toEqual({
        superTab: "economy",
        subTab: "resources",
      });
    });

    it("?tab=admin without admin privileges falls back to the default, not a redacted admin view", () => {
      expect(resolveTabs("admin", null, false)).toEqual({ superTab: "overview", subTab: "" });
    });

    it("?tab=admin with admin privileges resolves to governance/admin", () => {
      expect(resolveTabs("admin", null, true)).toEqual({
        superTab: "governance",
        subTab: "admin",
      });
    });
  });

  describe("edge cases", () => {
    it("defaults to overview when no tab param is present", () => {
      expect(resolveTabs(null, null, false)).toEqual({ superTab: "overview", subTab: "" });
    });

    it("falls back to the first sub-tab when sub is invalid for the given super-tab", () => {
      expect(resolveTabs("economy", "not-a-real-subtab", false)).toEqual({
        superTab: "economy",
        subTab: "sectors",
      });
    });

    it("does not resolve governance/admin sub-tab for a non-admin even via the new format", () => {
      const result = resolveTabs("governance", "admin", false);
      expect(result.subTab).not.toBe("admin");
    });

    it("resolves governance/admin for an admin via the new format", () => {
      expect(resolveTabs("governance", "admin", true)).toEqual({
        superTab: "governance",
        subTab: "admin",
      });
    });

    it("unrecognized tab param falls back to the default", () => {
      expect(resolveTabs("not-a-real-tab", null, false)).toEqual({
        superTab: "overview",
        subTab: "",
      });
    });
  });
});
