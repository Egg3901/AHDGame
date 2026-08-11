import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBS,
  MAIN_TAB_IDS,
  SUB_GROUPS_BY_TAB,
  SUB_TABS_BY_TAB,
  getAdminDestinations,
} from "./AdminTabsConfig";

describe("SUB_GROUPS_BY_TAB", () => {
  it("covers every sub-tab exactly once for each grouped tab", () => {
    for (const [tab, groups] of Object.entries(SUB_GROUPS_BY_TAB)) {
      const subIds = SUB_TABS_BY_TAB[tab as keyof typeof SUB_TABS_BY_TAB].map((s) => s.id);
      const grouped = (groups ?? []).flatMap((g) => g.ids);
      expect(grouped.slice().sort()).toEqual(subIds.slice().sort());
      expect(new Set(grouped).size).toBe(grouped.length);
    }
  });

  it("has a group config for every tab that has sub-tabs", () => {
    for (const tab of MAIN_TAB_IDS) {
      if (SUB_TABS_BY_TAB[tab].length > 0) {
        expect(SUB_GROUPS_BY_TAB[tab], `missing SUB_GROUPS_BY_TAB entry for ${tab}`).toBeDefined();
      }
    }
  });
});

describe("getAdminDestinations", () => {
  it("indexes every main tab and sub-tab", () => {
    const dests = getAdminDestinations();
    for (const tab of MAIN_TAB_IDS) {
      expect(dests.some((d) => d.tab === tab && !d.sub)).toBe(true);
      for (const sub of SUB_TABS_BY_TAB[tab]) {
        expect(
          dests.some((d) => d.tab === tab && d.sub === sub.id && !d.params),
          `missing destination ${tab}/${sub.id}`
        ).toBe(true);
      }
    }
  });

  it("points default subs at valid sub-tabs", () => {
    for (const tab of MAIN_TAB_IDS) {
      const def = DEFAULT_SUBS[tab];
      if (def) {
        expect(SUB_TABS_BY_TAB[tab].map((s) => s.id)).toContain(def);
      }
    }
  });
});
