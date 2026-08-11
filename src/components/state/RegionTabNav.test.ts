import { describe, expect, it } from "vitest";
import { resolveTabs } from "./RegionTabNav";

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

    it("resolves Demographics' Metrics sub-tab, not just the default Demographics", () => {
      expect(resolveTabs("demographics", "metrics", false)).toEqual({
        superTab: "demographics",
        subTab: "metrics",
      });
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
      expect(resolveTabs("metrics", null, false)).toEqual({
        superTab: "demographics",
        subTab: "metrics",
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
