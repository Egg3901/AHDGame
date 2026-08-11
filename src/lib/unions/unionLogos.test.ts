import { describe, expect, it } from "vitest";
import { UNION_LOGOS, unionLogoUrl } from "./unionLogos";
import { UNION_NAMES_BY_ERA } from "@/lib/seeds/reference/unionNames";

/** Every union name any era can seed. */
function seededNames(): Set<string> {
  const names = new Set<string>();
  for (const byCountry of Object.values(UNION_NAMES_BY_ERA)) {
    for (const bySector of Object.values(byCountry ?? {})) {
      for (const name of Object.values(bySector ?? {})) {
        if (name) names.add(name);
      }
    }
  }
  return names;
}

describe("unionLogoUrl", () => {
  it("every exact key is a name some era actually seeds", () => {
    // A key that matches nothing is a logo nobody will ever see — usually a
    // typo or a union renamed in the seed since the logo was added.
    const seeded = seededNames();
    const orphans = Object.keys(UNION_LOGOS).filter((k) => !seeded.has(k));
    expect(orphans).toEqual([]);
  });

  it("resolves a confederation's industry federations to the parent mark", () => {
    expect(unionLogoUrl("FIOM-CGIL")).toContain("CGIL.svg");
    expect(unionLogoUrl("CCOO Health Federation")).toContain("Comisiones_Obreras");
    expect(unionLogoUrl("CGT Mines Federation")).toContain("Travail_logo");
  });

  it("uses Wikipedia's fair-use upload where Commons has no free licence", () => {
    expect(unionLogoUrl("United Auto Workers")).toContain("en.wikipedia.org");
    expect(unionLogoUrl("International Brotherhood of Teamsters")).toContain("en.wikipedia.org");
  });

  it("returns null rather than a stand-in when no correct emblem exists", () => {
    // The British AEU's own article carries the *Australian* AEU's logo, so it
    // deliberately has no entry — a wrong logo is worse than the sector emblem.
    expect(unionLogoUrl("Amalgamated Engineering Union")).toBeNull();
    expect(unionLogoUrl(null)).toBeNull();
    expect(unionLogoUrl("")).toBeNull();
  });

  it("covers every East German and Chinese union, which seed one federation", () => {
    expect(unionLogoUrl("Free German Trade Union Federation")).toContain("FDGB");
    expect(unionLogoUrl("All-China Federation of Trade Unions")).toContain("ACFTU");
  });

  it("does not match a confederation prefix inside an unrelated name", () => {
    expect(unionLogoUrl("CGTP Portugal")).toBeNull();
  });
});
