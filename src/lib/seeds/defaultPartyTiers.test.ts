import { describe, expect, it } from "vitest";
import { resolveSeedPartyTier } from "./defaultPartyTiers";
import { politicalParties as usParties } from "./reference/politicalParties";
import { ukParties } from "./uk/ukParties";
import { deParties } from "./de/deParties";
import { jpParties } from "./jp/jpParties";
import { brParties } from "./br/brParties";
import { ieParties } from "./ie/ieParties";
import { cnParties } from "./cn/cnParties";
import { isPartyValidForPreset } from "./ensureDefaultParties";

const seed = (countryId: string, abbreviation: string, isDefault = true) => ({
  countryId,
  abbreviation,
  isDefault,
});

describe("resolveSeedPartyTier", () => {
  it("custom parties always seed Minor", () => {
    expect(resolveSeedPartyTier(seed("US", "DEM", false), "2019-default")).toBe("minor");
  });

  it("US majors seed Major in both eras", () => {
    expect(resolveSeedPartyTier(seed("US", "DEM"), "1991-default")).toBe("major");
    expect(resolveSeedPartyTier(seed("US", "REP"), "2019-default")).toBe("major");
  });

  it("regional UK parties seed Minor; LAB/CON/LD seed Major", () => {
    expect(resolveSeedPartyTier(seed("UK", "SNP"), "2019-default")).toBe("minor");
    expect(resolveSeedPartyTier(seed("UK", "PC"), "1991-default")).toBe("minor");
    expect(resolveSeedPartyTier(seed("UK", "LAB"), "1991-default")).toBe("major");
    expect(resolveSeedPartyTier(seed("UK", "LD"), "2019-default")).toBe("major");
  });

  it("DE Greens are Minor in 1991 but Major in 2019 (per-preset)", () => {
    expect(resolveSeedPartyTier(seed("DE", "GRN"), "1991-default")).toBe("minor");
    expect(resolveSeedPartyTier(seed("DE", "GRN"), "2019-default")).toBe("major");
  });

  it("DE CSU/FDP seed Minor", () => {
    expect(resolveSeedPartyTier(seed("DE", "CSU"), "2019-default")).toBe("minor");
    expect(resolveSeedPartyTier(seed("DE", "FDP"), "2019-default")).toBe("minor");
  });

  it("BR PT is Minor in 1991 but Major in 2019 (per-preset)", () => {
    expect(resolveSeedPartyTier(seed("BR", "PT"), "1991-default")).toBe("minor");
    expect(resolveSeedPartyTier(seed("BR", "PT"), "2019-default")).toBe("major");
  });

  it("CN CCP seeds Major; approved minors seed Minor", () => {
    expect(resolveSeedPartyTier(seed("CN", "CCP"), "2019-default")).toBe("major");
    expect(resolveSeedPartyTier(seed("CN", "CDL"), "2019-default")).toBe("minor");
  });
});

// ─── Full per-preset roster lock (regression guard) ──────────────────────────
//
// Asserts the exact Major set per country for each reset preset, computed from
// the real seed arrays via resolveSeedPartyTier + isPartyValidForPreset. A seed
// edit that flips a tier (or the per-preset GRN/PT/SF cases) breaks this.

const ALL_SEEDS = [
  ...usParties,
  ...ukParties,
  ...deParties,
  ...jpParties,
  ...brParties,
  ...ieParties,
  ...cnParties,
];

const EXPECTED_MAJORS: Record<string, Record<string, string[]>> = {
  "1991-default": {
    US: ["DEM", "REP"],
    UK: ["CON", "LAB", "LD"],
    DE: ["CDU", "SPD"],
    JP: ["JSP", "LDP"],
    BR: ["PFL", "PMDB"],
    IE: ["FF", "FG"],
    CN: ["CCP"],
  },
  "2019-default": {
    US: ["DEM", "REP"],
    UK: ["CON", "LAB", "LD"],
    DE: ["CDU", "GRN", "SPD"],
    JP: ["CDP", "LDP"],
    BR: ["PL", "PT"],
    IE: ["FF", "FG", "SF"],
    CN: ["CCP"],
  },
};

describe("seed-tier roster per preset", () => {
  for (const preset of ["1991-default", "2019-default"] as const) {
    it(`assigns the expected Major/Minor split for ${preset}`, () => {
      const valid = ALL_SEEDS.filter((s) => isPartyValidForPreset(s, preset));
      const majorsByCountry: Record<string, string[]> = {};
      for (const s of valid) {
        const tier = resolveSeedPartyTier(s, preset);
        expect(tier === "major" || tier === "minor").toBe(true);
        if (tier === "major") (majorsByCountry[s.countryId] ??= []).push(s.abbreviation);
      }
      for (const country of Object.keys(EXPECTED_MAJORS[preset])) {
        expect([...(majorsByCountry[country] ?? [])].sort()).toEqual(
          [...EXPECTED_MAJORS[preset][country]].sort()
        );
      }
      // No country outside the expected map should have any Major default.
      for (const country of Object.keys(majorsByCountry)) {
        expect(EXPECTED_MAJORS[preset][country]).toBeDefined();
      }
    });
  }

  it("DE Greens and BR PT flip Minor→Major between 1991 and 2019", () => {
    const grn = deParties.find((p) => p.abbreviation === "GRN")!;
    const pt = brParties.find((p) => p.abbreviation === "PT")!;
    expect(resolveSeedPartyTier(grn, "1991-default")).toBe("minor");
    expect(resolveSeedPartyTier(grn, "2019-default")).toBe("major");
    expect(resolveSeedPartyTier(pt, "1991-default")).toBe("minor");
    expect(resolveSeedPartyTier(pt, "2019-default")).toBe("major");
  });
});
