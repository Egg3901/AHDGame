import { describe, expect, it } from "vitest";
import { buildNationalDetailsSections } from "./nationDetailsSections";
import { buildStaffNavItems } from "./staffNavItems";
import { buildWorldNavItems, buildWorldNavSections } from "./worldNavItems";
import { buildProfileNavItems } from "./profileNavItems";
import { buildElectionsSubNavItems, buildLegislatureSubNavItems } from "./experimentalNavMenus";
import enCatalog from "../../../messages/en/nav.json";
import deCatalog from "../../../messages/de/nav.json";

function resolveMessage(catalog: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      (catalog as { nav: unknown }).nav
    );
}

describe("nav link inventory parity", () => {
  it("world builder includes desktop WorldDropdown core routes", () => {
    const hrefs = buildWorldNavItems({
      countryId: "US",
      myCorporationId: 1,
      conflictsEnabled: true,
      unionsEnabled: true,
    })
      .filter((i) => i.show)
      .map((i) => i.href);

    expect(hrefs).toContain("/world/legacy");
    expect(hrefs).toContain("/world/trade");
    expect(hrefs).toContain("/world/conflicts");
    expect(hrefs).toContain("/unions");
    expect(hrefs).toContain("/corporation/1");
  });

  it("staff builder matches canonical staff routes", () => {
    // Unfiltered: Ops Dashboard visibility depends on NEXT_PUBLIC_OPS_DASHBOARD_URL,
    // covered in staffNavItems.test.ts. The inventory only guards the route list.
    const labels = buildStaffNavItems({ isAdmin: true, isModerator: true }).map((i) => i.label);

    expect(labels).toContain("Admin Panel");
    expect(labels).toContain("Mod Panel");
    expect(labels).toContain("Ops Dashboard");
  });

  it("US legislature submenu preserves congress routes", () => {
    const hrefs = buildLegislatureSubNavItems("US").map((i) => i.href);
    expect(hrefs).toContain("/congress");
    expect(hrefs).toContain("/congress?chamber=senate");
  });

  it("UK legislature submenu uses country-config path", () => {
    const hrefs = buildLegislatureSubNavItems("UK").map((i) => i.href);
    expect(hrefs).toContain("/country/uk/legislature");
  });

  it("national details sections cover government and economy routes", () => {
    const hrefs = buildNationalDetailsSections("US")
      .flatMap((s) => s.items)
      .map((i) => i.href);

    expect(hrefs.some((h) => h.includes("legislature") || h.includes("congress"))).toBe(true);
    expect(hrefs.some((h) => h.includes("economy") || h.includes("budget"))).toBe(true);
  });

  it("US elections submenu includes primaries and politicians", () => {
    const labels = buildElectionsSubNavItems("US").map((i) => i.label);
    expect(labels).toContain("Primaries");
    expect(labels).toContain("Candidate directory");
    expect(labels).toContain("Political Operations");
  });

  it("every builder labelKey/titleKey resolves in the en and de catalogs", () => {
    const worldItems = buildWorldNavItems({
      countryId: "US",
      myCorporationId: 1,
      conflictsEnabled: true,
      unionsEnabled: true,
    });
    const nationSections = buildNationalDetailsSections("US", {
      activePresidentElection: { id: "e1", seatId: "US-president" },
      hasActiveReferendumCampaign: true,
      unionsEnabled: true,
    });
    const keys = [
      ...worldItems.map((i) => i.labelKey),
      ...buildWorldNavSections(worldItems).map((g) => g.titleKey),
      ...buildStaffNavItems({ isAdmin: true, isModerator: true }).map((i) => i.labelKey),
      ...buildProfileNavItems({
        myCorporationId: 1,
        myUnionId: "u1",
        unionsEnabled: true,
      }).map((i) => i.labelKey),
      ...nationSections.flatMap((s) => [
        s.titleKey,
        ...s.items.map((i) => i.labelKey).filter((k): k is string => !!k),
      ]),
      ...buildLegislatureSubNavItems("US")
        .map((i) => i.labelKey)
        .filter((k): k is string => !!k),
      ...buildElectionsSubNavItems("US")
        .map((i) => i.labelKey)
        .filter((k): k is string => !!k),
    ];
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(typeof resolveMessage(enCatalog, key), `en missing ${key}`).toBe("string");
      expect(typeof resolveMessage(deCatalog, key), `de missing ${key}`).toBe("string");
    }
  });
});
