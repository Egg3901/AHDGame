import { describe, expect, it } from "vitest";
import { resolveSuperTabs } from "@/components/nav/SuperTabNav";
import {
  ALL_CORP_TABS,
  CORP_GROUPS,
  CORP_LEGACY_TAB_MAP,
  buildCorpNavTabs,
  corpNavLocation,
  corpTabIdFor,
} from "./CorporationTabGroups";
import { CORP_TABS, CEO_TAB, DEALS_TAB, STRUCTURE_TAB } from "./CorporationPageConstants";
import type { CorpTabId } from "./CorporationPageTypes";

const allNav = buildCorpNavTabs(ALL_CORP_TABS);

function resolveToTabId(tabParam: string | null, subParam: string | null = null) {
  const r = resolveSuperTabs(allNav, tabParam, subParam, CORP_LEGACY_TAB_MAP, "overview");
  return corpTabIdFor(ALL_CORP_TABS, r.superTab, r.subTab);
}

describe("corporation tab grouping", () => {
  it("keeps the top-level tab count small enough not to need sideways scrolling", () => {
    expect(allNav.length).toBeLessThanOrEqual(5);
  });

  it("gives every tab exactly one home — nothing was dropped in the regrouping", () => {
    const grouped = CORP_GROUPS.flatMap((g) => g.tabIds);
    const everyTabId = ALL_CORP_TABS.map((t) => t.id);
    expect([...grouped].sort()).toEqual([...everyTabId].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  describe("old flat ?tab= deep links still land on the same destination", () => {
    const cases: CorpTabId[] = [
      ...CORP_TABS.map((t) => t.id),
      DEALS_TAB.id,
      STRUCTURE_TAB.id,
      CEO_TAB.id,
    ];
    it.each(cases)("?tab=%s", (tabId) => {
      expect(resolveToTabId(tabId)).toBe(tabId);
    });

    it("pre-merge credit ids still land on Credit & Bonds", () => {
      expect(resolveToTabId("credit-rating")).toBe("credit");
      expect(resolveToTabId("bonds")).toBe("credit");
    });

    it("the old ?tab=settings CEO alias lands in the CEO Office", () => {
      expect(resolveToTabId("settings")).toBe("ceo");
    });

    it("an unknown tab param falls back to Overview", () => {
      expect(resolveToTabId("not-a-real-tab")).toBe("overview");
      expect(resolveToTabId(null)).toBe("overview");
    });
  });

  describe("new grouped links", () => {
    it("resolves a group + sub pair", () => {
      expect(resolveToTabId("finance", "snapshot")).toBe("snapshot");
      expect(resolveToTabId("operations", "commodities")).toBe("commodities");
      expect(resolveToTabId("ownership", "deals")).toBe("deals");
    });

    it("falls back to the group's first sub-tab when the sub is invalid", () => {
      expect(resolveToTabId("finance", "nonsense")).toBe("financials");
    });

    it("single-panel groups need no sub param", () => {
      expect(corpNavLocation(ALL_CORP_TABS, "overview")).toEqual({
        superTab: "overview",
        subTab: "",
      });
      expect(corpNavLocation(ALL_CORP_TABS, "ceo")).toEqual({ superTab: "ceo", subTab: "" });
    });
  });

  describe("the Defence tab is gated to corporations that build materiel", () => {
    // The page gates on `type === "defense" || secondaryType === "defense"`, mirroring the
    // extraction gate beside it. A corp with no defence line can never hold a procurement
    // contract, so an ungated tab would be permanently empty for most of the market.
    const nonDefence = CORP_TABS.filter((t) => t.id !== "defence");
    const nonDefenceNav = buildCorpNavTabs(nonDefence);

    it("is reachable for a defence corp", () => {
      expect(resolveToTabId("operations", "defence")).toBe("defence");
    });

    it("a ?tab=operations&sub=defence deep link cannot reach it otherwise", () => {
      const r = resolveSuperTabs(
        nonDefenceNav,
        "operations",
        "defence",
        CORP_LEGACY_TAB_MAP,
        "overview"
      );
      expect(corpTabIdFor(nonDefence, r.superTab, r.subTab)).not.toBe("defence");
    });

    it("lives with the other production concerns, not off on its own", () => {
      const operations = CORP_GROUPS.find((g) => g.id === "operations");
      expect(operations?.tabIds).toContain("defence");
    });
  });

  describe("viewer gating is respected", () => {
    // A logged-out viewer of a private corp only ever sees Overview + Sectors.
    const privateVisible = CORP_TABS.filter((t) => t.id === "overview" || t.id === "sectors");
    const privateNav = buildCorpNavTabs(privateVisible);

    it("drops groups whose members are all hidden", () => {
      expect(privateNav.map((t) => t.id)).toEqual(["overview", "operations"]);
    });

    it("renders no sub-tab row for a group left with one visible member", () => {
      expect(privateNav.find((t) => t.id === "operations")?.subTabs).toBeUndefined();
      expect(corpTabIdFor(privateVisible, "operations", "")).toBe("sectors");
    });

    it("a ?tab=shares deep link cannot reach the hidden shares tab", () => {
      const r = resolveSuperTabs(privateNav, "shares", null, CORP_LEGACY_TAB_MAP, "overview");
      expect(corpTabIdFor(privateVisible, r.superTab, r.subTab)).toBe("overview");
    });

    it("a ?tab=ceo deep link cannot reach the CEO Office for a non-CEO viewer", () => {
      const nonCeoNav = buildCorpNavTabs(CORP_TABS);
      const r = resolveSuperTabs(nonCeoNav, "ceo", null, CORP_LEGACY_TAB_MAP, "overview");
      expect(corpTabIdFor(CORP_TABS, r.superTab, r.subTab)).toBe("overview");
    });
  });
});
