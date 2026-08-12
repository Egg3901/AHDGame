import { describe, expect, it } from "vitest";
import {
  buildWorldNavItems,
  buildWorldNavSections,
  looseWorldNavItems,
  visibleWorldNavItems,
} from "./worldNavItems";

describe("buildWorldNavItems", () => {
  it("includes leaderboard and trade for all users", () => {
    const items = visibleWorldNavItems({ countryId: "US" });
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Hall of Fame");
    expect(labels).toContain("Trade");
    expect(labels).toContain("Nations");
  });

  it("gates conflicts and unions behind feature flags", () => {
    const off = visibleWorldNavItems({ conflictsEnabled: false, unionsEnabled: false });
    expect(off.map((i) => i.id)).not.toContain("conflicts");
    expect(off.map((i) => i.id)).not.toContain("unions");

    const on = visibleWorldNavItems({ conflictsEnabled: true, unionsEnabled: true });
    expect(on.map((i) => i.id)).toContain("conflicts");
    expect(on.map((i) => i.id)).toContain("unions");
  });

  it("shows corporation link only when CEO", () => {
    const without = visibleWorldNavItems({ myCorporationId: null });
    expect(without.map((i) => i.id)).not.toContain("myCorporation");

    const withCorp = visibleWorldNavItems({ myCorporationId: 42 });
    const corp = withCorp.find((i) => i.id === "myCorporation");
    expect(corp?.href).toBe("/corporation/42");
    expect(corp?.primary).toBe(true);
  });

  it("scopes news link to country", () => {
    const uk = buildWorldNavItems({ countryId: "UK" }).find((i) => i.id === "news");
    expect(uk?.href).toBe("/news?country=uk");
  });

  it("includes country-scoped map link", () => {
    const us = buildWorldNavItems({ countryId: "US" }).find((i) => i.id === "map");
    expect(us?.label).toBe("Map");
    expect(us?.href).toContain("/country/us");
  });
});

describe("buildWorldNavSections / looseWorldNavItems", () => {
  it("puts My Corporation in the loose list, not any group", () => {
    const items = visibleWorldNavItems({ myCorporationId: 42 });
    const loose = looseWorldNavItems(items);
    expect(loose.map((i) => i.id)).toEqual(["myCorporation"]);

    const groups = buildWorldNavSections(items);
    expect(groups.some((g) => g.items.some((i) => i.id === "myCorporation"))).toBe(false);
  });

  it("groups every non-loose visible item under exactly one category", () => {
    const items = visibleWorldNavItems({
      myCorporationId: 1,
      conflictsEnabled: true,
      unionsEnabled: true,
    });
    const grouped = buildWorldNavSections(items).flatMap((g) => g.items.map((i) => i.id));
    const loose = looseWorldNavItems(items).map((i) => i.id);
    const accountedFor = new Set([...grouped, ...loose]);

    for (const item of items) {
      expect(accountedFor.has(item.id)).toBe(true);
    }
    // No duplicates across groups.
    expect(grouped.length).toBe(new Set(grouped).size);
  });

  it("drops a group entirely when all its items are hidden", () => {
    // Diplomacy's only feature-gated item is `conflicts`; with it off the
    // group still has other members, so assert on a case that actually
    // empties out: filter items down to just a corporate-only list.
    const groups = buildWorldNavSections([
      {
        id: "myCorporation",
        label: "My Corporation",
        href: "/corporation/1",
        section: "corporate",
        show: true,
      },
    ]);
    expect(groups).toEqual([]);
  });

  // Order is traffic-derived: Economy leads on Stock Market (2.82% of all
  // pageviews), Leaderboards is last because Hall of Fame drew no measurable
  // traffic at all. See WORLD_NAV_GROUPS for the full breakdown.
  it("keeps group order stable: Economy, Diplomacy, Other, Leaderboards", () => {
    const items = visibleWorldNavItems({ conflictsEnabled: true, unionsEnabled: true });
    const titles = buildWorldNavSections(items).map((g) => g.title);
    expect(titles).toEqual(["Economy", "Diplomacy", "Other", "Leaderboards"]);
  });

  it("includes Banking in the Economy group", () => {
    const items = visibleWorldNavItems({ countryId: "US" });
    expect(items.map((i) => i.id)).toContain("banking");
    const economy = buildWorldNavSections(items).find((g) => g.id === "economy");
    expect(economy?.items.map((i) => i.id)).toContain("banking");
    expect(items.find((i) => i.id === "banking")?.href).toBe("/banking");
  });
});
