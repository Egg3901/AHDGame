import { describe, expect, it } from "vitest";
import { CDN_BASE, CDN_GEO, CDN_HERO_SLUGS } from "@/lib/images/cdnUrls";
import { ACTION_IMAGE_SLUGS } from "@/lib/images/actionImages";
import { CDN_HERO_LINCOLN_URL, CDN_LOGIN_IMAGES, CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { buildCdnCatalog } from "./cdn";

describe("buildCdnCatalog", () => {
  const configured = (url: string) => url.replace("https://cdn.ahousedividedgame.com", CDN_BASE);
  it("reports the configured CDN base and the static URL pattern", () => {
    const catalog = buildCdnCatalog();

    expect(catalog.cdnBase).toBe(CDN_BASE);
    expect(catalog.urlPattern).toBe(`${CDN_BASE}/static/{category}/{slug}.{ext}`);
    expect(catalog.defaultExtension).toBe("webp");
  });

  it("has unique categories whose templates live under their own directory", () => {
    const catalog = buildCdnCatalog();
    const names = catalog.categories.map((category) => category.name);

    expect(new Set(names).size).toBe(names.length);
    for (const category of catalog.categories) {
      expect(category.description).toBeTruthy();
      expect(category.urlTemplates.length).toBeGreaterThan(0);
      for (const template of category.urlTemplates) {
        expect(template.startsWith(`${CDN_BASE}/static/${category.name}/`)).toBe(true);
      }
    }
  });

  it("enumerates slugs only where a template can substitute them", () => {
    for (const category of buildCdnCatalog().categories) {
      if (!category.slugs?.length) continue;
      const substitutable = category.urlTemplates.some(
        (template) => template.includes("{slug}") || template.includes("{file}")
      );
      expect(substitutable, `category ${category.name}`).toBe(true);
    }
  });

  it("enumerates hero slugs from the shared runtime list", () => {
    const heroes = buildCdnCatalog().categories.find((category) => category.name === "heroes");

    expect(heroes?.slugs).toEqual(CDN_HERO_SLUGS);
  });

  it("lists one login slug per published era", () => {
    const login = buildCdnCatalog().categories.find((category) => category.name === "login");

    expect(login?.slugs).toEqual(Object.keys(CDN_LOGIN_IMAGES).map((era) => `login-${era}`));
  });

  it("exposes every action slug and its era art availability", () => {
    const { actionCards } = buildCdnCatalog().assets;

    expect(actionCards.slugs).toEqual(ACTION_IMAGE_SLUGS);
    expect(Object.keys(actionCards.urls).sort()).toEqual([...ACTION_IMAGE_SLUGS].sort());
    for (const url of Object.values(actionCards.urls)) {
      expect(url.startsWith(`${CDN_BASE}/`)).toBe(true);
    }
    expect(actionCards.eraGenericSets).toContain("1953");
    // Era → country → published slugs, so clients can build URLs that exist.
    expect(Object.keys(actionCards.countryArt["1953"])).toEqual(
      expect.arrayContaining(["US", "UK", "FR", "DD"])
    );
    expect(actionCards.countryArt["1953"].FR).toEqual(["advertise"]);
    expect(actionCards.countryArt["1979"].RU).toEqual(
      expect.arrayContaining(["campaign", "convertCash", "hero"])
    );
  });

  it("resolves curated assets against the configured CDN base", () => {
    const { assets } = buildCdnCatalog();

    expect(assets.logo).toBe(configured(CDN_LOGO_URL));
    expect(assets.heroFallback).toBe(configured(CDN_HERO_LINCOLN_URL));
    expect(assets.loginHeroByEra).toEqual(
      Object.fromEntries(
        Object.entries(CDN_LOGIN_IMAGES).map(([era, url]) => [era, configured(url)])
      )
    );
    expect(assets.geoJson).toEqual(CDN_GEO);
    for (const url of [
      assets.logo,
      assets.heroFallback,
      assets.scotusBuilding,
      assets.techTierPlaceholder,
      ...Object.values(assets.geoJson),
      ...Object.values(assets.loginHeroByEra),
    ]) {
      expect(url.startsWith(`${CDN_BASE}/`)).toBe(true);
    }
  });
});
