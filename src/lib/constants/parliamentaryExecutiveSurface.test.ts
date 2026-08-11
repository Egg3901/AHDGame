import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS } from "./countries";
import { getParliamentaryExecutiveSurface } from "./parliamentaryExecutiveSurface";

describe("getParliamentaryExecutiveSurface", () => {
  it("returns the bespoke UK surface with the imperial-possessive hero title", () => {
    const uk = getParliamentaryExecutiveSurface("UK");
    expect(uk.headPlaque.sealGlyph).toBe("PM");
    expect(uk.oppositionPlaque.vacancyNote).toContain("Commons");
    expect(uk.seatsPanel.title).toBe("Commons seats by party");
    expect(uk.hero.title).toBeNull();
    expect(uk.heroTitleUsesImperialPossessive).toBe(true);
    expect(uk.deputyPlaque).toBeUndefined();
  });

  it("returns the bespoke IE surface with the Tánaiste deputy plaque", () => {
    const ie = getParliamentaryExecutiveSurface("IE");
    expect(ie.executiveTitle).toBe("Taoiseach");
    expect(ie.memberLabel).toBe("TD");
    expect(ie.deputyPlaque).toMatchObject({
      title: "Tánaiste",
      cabinetPositionId: "tanaiste",
    });
    expect(ie.seatsPanel.title).toBe("Dáil seats by party");
  });

  it("returns the bespoke DE and JP surfaces", () => {
    const de = getParliamentaryExecutiveSurface("DE");
    expect(de.executiveTitle).toBe("Chancellor");
    expect(de.headPlaque.sealGlyph).toBe("BK");
    expect(de.hero.breadcrumbLast).toBe("Federal Chancellery");

    const jp = getParliamentaryExecutiveSurface("JP");
    expect(jp.headPlaque.sealGlyph).toBe("総");
    expect(jp.oppositionPlaque.vacancyNote).toContain("Diet");
    expect(jp.hero.image).toBe("/api/images/hero/kantei");
  });

  it("yields a complete surface for every configured parliamentary country", () => {
    // The /country/[code]/executive page dispatches every parliamentary
    // country to the shared hub — each must resolve a renderable surface.
    for (const config of Object.values(COUNTRY_CONFIGS)) {
      if (
        config.governmentType !== "parliamentaryMonarchy" &&
        config.governmentType !== "parliamentaryRepublic"
      ) {
        continue;
      }
      const surface = getParliamentaryExecutiveSurface(config.id);
      expect(surface.executiveTitle, config.id).toBeTruthy();
      expect(surface.headPlaque.sealGlyph, config.id).toBeTruthy();
      expect(surface.oppositionPlaque.vacancyNote, config.id).toBeTruthy();
      expect(surface.seatsPanel.title, config.id).toBeTruthy();
      expect(surface.hero.image, config.id).toBeTruthy();
      expect(surface.hero.tagline, config.id).toBeTruthy();
    }
  });

  it("derives a complete default surface for a parliamentary country without a bespoke entry", () => {
    // BR has no bespoke entry — the derived surface must be fully populated
    // from COUNTRY_CONFIGS so a newly-added parliamentary country renders
    // without a per-country hub rebuild.
    const derived = getParliamentaryExecutiveSurface("BR");
    expect(derived.executiveTitle).toBeTruthy();
    expect(derived.headPlaque.sealGlyph).toBeTruthy();
    expect(derived.headPlaque.vacancyNote).toContain(derived.executiveTitle);
    expect(derived.oppositionPlaque.title).toBe("Leader of the Opposition");
    expect(derived.seatsPanel.title).toMatch(/seats by party$/);
    expect(derived.hero.image).toBeTruthy();
    expect(derived.hero.title).toBeTruthy();
    expect(derived.deputyPlaque).toBeUndefined();
  });
});
