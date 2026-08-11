import { describe, expect, it } from "vitest";
import { ngParties } from "./ngParties";
import { isPartyValidForPreset } from "@/lib/seeds/ensureDefaultParties";

const abbr = (preset: string) =>
  ngParties
    .filter((p) => isPartyValidForPreset(p, preset))
    .map((p) => p.abbreviation)
    .sort();

describe("ngParties preset gating", () => {
  it("1953-default seeds the late-colonial triad (NCNC, AG, NPC)", () => {
    expect(abbr("1953-default")).toEqual(["AG", "NCNC", "NPC"]);
  });

  it("1991-default seeds the Third Republic two-party system (SDP, NRC)", () => {
    expect(abbr("1991-default")).toEqual(["NRC", "SDP"]);
  });

  it("1979-default seeds the Second Republic five (NPN, UPN, NPP, GNPP, PRP)", () => {
    expect(abbr("1979-default")).toEqual(["GNPP", "NPN", "NPP", "PRP", "UPN"]);
  });

  it("2019-default seeds the modern roster and excludes SDP/NRC/NCNC/AG/NPC", () => {
    const a = abbr("2019-default");
    expect(a).toContain("APC");
    expect(a).toContain("PDP");
    expect(a).not.toContain("SDP");
    expect(a).not.toContain("NRC");
    expect(a).not.toContain("NCNC");
    expect(a).not.toContain("AG");
    expect(a).not.toContain("NPC");
  });

  it("every NG party is scoped to NG and declares its eras", () => {
    for (const p of ngParties) {
      expect(p.countryId).toBe("NG");
      expect(Array.isArray(p.validForPresets) && p.validForPresets.length > 0).toBe(true);
    }
  });
});
