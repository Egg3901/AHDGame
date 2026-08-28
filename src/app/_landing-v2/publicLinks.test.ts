import { describe, expect, it } from "vitest";
import { LANDING_FOOTER_SECTIONS, LANDING_TRAY_LINKS } from "./publicLinks";
import enCatalog from "../../../messages/en/auth.json";
import deCatalog from "../../../messages/de/auth.json";

function resolveMessage(catalog: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      (catalog as { auth: unknown }).auth
    );
}

const LOCALES = [
  ["en", enCatalog],
  ["de", deCatalog],
] as const;

describe("landing public link inventory", () => {
  const allLinks = LANDING_FOOTER_SECTIONS.flatMap((section) => section.links);

  it.each(LOCALES)("every footer label and heading resolves in %s", (_locale, catalog) => {
    for (const section of LANDING_FOOTER_SECTIONS) {
      expect(resolveMessage(catalog, section.headingKey)).toBeTypeOf("string");
      for (const link of section.links) {
        expect(resolveMessage(catalog, link.labelKey)).toBeTypeOf("string");
      }
    }
  });

  it.each(LOCALES)("every tray label resolves in %s", (_locale, catalog) => {
    expect(LANDING_TRAY_LINKS.length).toBeGreaterThan(0);
    for (const link of LANDING_TRAY_LINKS) {
      expect(resolveMessage(catalog, link.labelKey)).toBeTypeOf("string");
    }
  });

  it.each(LOCALES)("tray heading, dek and nav label resolve in %s", (_locale, catalog) => {
    for (const key of ["landing.tray.heading", "landing.tray.dek", "landing.tray.navLabel"]) {
      expect(resolveMessage(catalog, key)).toBeTypeOf("string");
    }
  });

  it("keeps the legal links the lander is required to surface", () => {
    const legal = LANDING_FOOTER_SECTIONS.find((s) => s.headingKey === "landing.footer.legal");
    expect(legal?.links.map((l) => l.href)).toEqual(["/privacy", "/terms", "/contact"]);
  });

  it("routes are unique and app-relative", () => {
    const hrefs = allLinks.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href.startsWith("/")).toBe(true);
    }
  });

  it("surfaces the public pages the footer used to omit", () => {
    const hrefs = allLinks.map((l) => l.href);
    for (const href of [
      "/tutorial",
      "/api-guide",
      "/officials",
      "/supporters",
      "/player-ads",
      "/world/trade",
      "/world/cold-war-ledger",
      "/world/legacy",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("excludes routes that hand a signed-out visitor an empty state", () => {
    // /world/german-question exports publicPageMetadata but returns a "No
    // character" empty state without a session, so it is not a public page in
    // the sense this inventory means. See publicLinks.ts.
    const hrefs = [...allLinks.map((l) => l.href), ...LANDING_TRAY_LINKS.map((l) => l.href)];
    expect(hrefs).not.toContain("/world/german-question");
  });

  it("tray is the browsable subset: no sign-up CTA, no legal column", () => {
    const trayHrefs = LANDING_TRAY_LINKS.map((l) => l.href);
    expect(trayHrefs).not.toContain("/register");
    expect(trayHrefs).not.toContain("/privacy");
    expect(trayHrefs).not.toContain("/terms");
    expect(trayHrefs).not.toContain("/contact");
    // Everything else in the footer is reachable from the tray.
    const expected = allLinks
      .map((l) => l.href)
      .filter((h) => !["/register", "/privacy", "/terms", "/contact"].includes(h));
    expect(trayHrefs).toEqual(expected);
  });
});
