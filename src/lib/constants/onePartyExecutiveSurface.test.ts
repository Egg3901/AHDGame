import { describe, expect, it } from "vitest";
import { getOnePartyExecutiveSurface } from "./onePartyExecutiveSurface";

describe("getOnePartyExecutiveSurface", () => {
  it("returns the bespoke CN surface with the NPCSC/CPPCC chair plaques", () => {
    const cn = getOnePartyExecutiveSurface("CN");
    expect(cn.executiveTitle).toBe("Premier");
    expect(cn.memberLabel).toBe("NPC Delegate");
    expect(cn.headOfStatePlaque.sealGlyph).toBe("主");
    expect(cn.rulingPartyName).toBe("Chinese Communist Party");
    expect(cn.legislatureChairPlaque?.congressLeaderRole).toBe("chair_npcsc");
    expect(cn.advisoryChairPlaque?.congressLeaderRole).toBe("chair_cppcc");
    expect(cn.seatsPanel.title).toBe("NPC seats by party");
    expect(cn.hero.image).toBe("/api/images/hero/zhongnanhai");
  });

  it("derives a complete default surface for a one-party country without a bespoke entry", () => {
    // No second one-party state exists yet — the derived surface must still be
    // fully populated from COUNTRY_CONFIGS so a future addition renders
    // without a per-country hub rebuild. (BR is not a one-party state; it is
    // only used here to exercise the derivation path.)
    const derived = getOnePartyExecutiveSurface("BR");
    expect(derived.executiveTitle).toBeTruthy();
    expect(derived.headOfStatePlaque.title).toBeTruthy();
    expect(derived.premierPlaque.vacancyNote).toContain(derived.executiveTitle);
    expect(derived.legislatureChairPlaque).toBeUndefined();
    expect(derived.advisoryChairPlaque).toBeUndefined();
    expect(derived.seatsPanel.title).toMatch(/seats by party$/);
    expect(derived.hero.image).toBeTruthy();
  });

  it("returns the bespoke RU surface with CPSU / Supreme Soviet copy", () => {
    const ru = getOnePartyExecutiveSurface("RU");
    expect(ru.executiveTitle).toBe("Premier");
    expect(ru.memberLabel).toBe("Supreme Soviet Deputy");
    expect(ru.rulingPartyName).toBe("Communist Party of the Soviet Union");
    expect(ru.rulingPartyShortName).toBe("CPSU");
    expect(ru.headOfStatePlaque.title).toBe("Chairman of the Presidium");
    expect(ru.seatsPanel.title).toBe("Supreme Soviet seats by party");
    // Era-correct hero: the USSR era config, not modern Russia.
    expect(ru.hero.title).toBe("Government of the Soviet Union");
  });

  // This asserted the opposite until DD was given a head-of-state office. The page
  // had been rendering "Vacant" against an office that did not exist, which is the
  // bug a DD player reported: an empty seat next to a ruling party that plainly had
  // a chairman. DD now syncs the seat to that chair, so the surface must say so.
  // DD now carries a bespoke surface, so the promise names the SED explicitly.
  it("promises an auto-seated head of state for DD, which syncs to the party chair", () => {
    const dd = getOnePartyExecutiveSurface("DD");
    expect(dd.headOfStatePlaque.vacancyNote).toContain("Auto-populated");
    expect(dd.headOfStatePlaque.vacancyNote).toContain("{roleLabel} of the SED");
    expect(dd.headOfStatePlaque.tenureLine).toContain("Socialist Unity Party of Germany");
  });

  it("returns the bespoke DD surface with SED / Volkskammer copy", () => {
    const dd = getOnePartyExecutiveSurface("DD");
    expect(dd.executiveTitle).toBe("General Secretary");
    expect(dd.memberLabel).toBe("Volkskammer Deputy");
    expect(dd.rulingPartyShortName).toBe("SED");
    expect(dd.headOfStatePlaque.title).toBe("Chairman of the Council of State");
    expect(dd.seatsPanel.title).toBe("Volkskammer seats by bloc party");
  });

  it("frames DD's non-SED parties as National Front bloc partners, not opposition", () => {
    // The CDU, LDPD, NDPD and DBD sat in the National Front and held their
    // Volkskammer seats by allocation. The generic surface labels this seat
    // "the largest opposition party", which is wrong for the DDR.
    const dd = getOnePartyExecutiveSurface("DD");
    expect(dd.oppositionNote).toContain("National Front");
    expect(dd.oppositionNote).not.toContain("opposition");
  });

  // The fallback branch still has to hold for a country with no head-of-state
  // configuration at all — it is what stops the plaque asserting a seat that was
  // never configured.
  it("does not promise an auto-seated head of state where none is configured", () => {
    const derived = getOnePartyExecutiveSurface("BR");
    expect(derived.headOfStatePlaque.vacancyNote).toContain("No separate head-of-state seat");
    expect(derived.headOfStatePlaque.tenureLine).toBeUndefined();
  });
});
