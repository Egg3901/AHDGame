// src/components/landing/blocColors.test.ts
import { describe, it, expect } from "vitest";
import { BLOC_COLORS, COUNTRY_BLOC_1979, getCountryBloc, BLOC_LEGEND } from "./blocColors";

describe("blocColors", () => {
  it("maps the 24 seed countries to 1979-accurate blocs", () => {
    const expected = {
      US: "nato",
      UK: "nato",
      FR: "nato",
      IT: "nato",
      DE: "nato",
      TR: "nato",
      RU: "comintern",
      DD: "comintern",
      PL: "comintern",
      RO: "comintern",
      HU: "comintern",
      CS: "comintern",
      BG: "comintern",
      UKR: "comintern",
      BLR: "comintern",
      BAL: "comintern",
      YU: "nonAligned",
      SE: "nonAligned",
      IE: "nonAligned",
      CN: "nonAligned",
      NG: "nonAligned",
      BR: "nonAligned",
      JP: "nonAligned",
    } as Record<string, string>;
    for (const [id, bloc] of Object.entries(expected)) {
      expect(COUNTRY_BLOC_1979[id as keyof typeof COUNTRY_BLOC_1979]).toBe(bloc);
    }
    expect(Object.keys(COUNTRY_BLOC_1979)).toHaveLength(24);
  });

  it("BLOC_COLORS are token references, not hex", () => {
    for (const c of Object.values(BLOC_COLORS)) {
      expect(c).toMatch(/^var\(--/);
    }
    expect(BLOC_COLORS.nato).toBe("var(--info)");
    expect(BLOC_COLORS.comintern).toBe("var(--danger)");
    expect(BLOC_COLORS.nonAligned).toBe("var(--success)");
    expect(BLOC_COLORS.disabled).toBe("var(--card-elevated)");
  });

  it("getCountryBloc returns disabled for non-seed countries", () => {
    expect(getCountryBloc("US")).toBe("nato");
    expect(getCountryBloc("RU")).toBe("comintern");
    // 'BR' here is the ISO id for Brazil in the world map? — BR is countryId in our seed.
    // Non-seed ISO ids resolve to disabled:
    expect(getCountryBloc("XX")).toBe("disabled");
    expect(getCountryBloc("MX")).toBe("disabled");
  });

  it("BLOC_LEGEND has the four blocs with labels + token colors", () => {
    const keys = BLOC_LEGEND.map((b) => b.bloc).sort();
    expect(keys).toEqual(["comintern", "disabled", "nato", "nonAligned"]);
    for (const b of BLOC_LEGEND) {
      expect(typeof b.label).toBe("string");
      expect(b.color).toMatch(/^var\(--/);
    }
  });
});
