import { describe, expect, it } from "vitest";
import { COUNTRY_ORDER } from "./countries";
import { getExecutiveSeal } from "./executiveSeals";

describe("getExecutiveSeal", () => {
  it("returns the presidential seal for the US", () => {
    const seal = getExecutiveSeal("US");
    expect(seal).not.toBeNull();
    expect(seal!.alt).toBe("Seal of the President of the United States");
  });

  it("marks the JP emblem as plain (no ivory medallion)", () => {
    expect(getExecutiveSeal("JP")!.backing).toBe("plain");
    // Heraldic emblems that need the disc leave backing unset (medallion default).
    expect(getExecutiveSeal("DE")!.backing).toBeUndefined();
  });

  it("configures a seal for every active country, each allowlist-safe", () => {
    // Every surfaced country (COUNTRY_ORDER) gets a real seal — and each URL uses
    // the 330px Wikimedia width the state-flags fix established (320px is rejected
    // by the thumbnail allowlist) on the already-allowed upload.wikimedia.org host.
    // Latent secession countries (SCO/WAL) are absent from COUNTRY_ORDER; their
    // executive imagery is finalized when they are surfaced (SP3). The 1979
    // Cold-War countries ARE in COUNTRY_ORDER and all carry curated seals.
    for (const id of COUNTRY_ORDER) {
      const seal = getExecutiveSeal(id);
      expect(seal, id).not.toBeNull();
      expect(seal!.alt.length, id).toBeGreaterThan(0);
      expect(seal!.src, id).toContain("https://upload.wikimedia.org/");
      expect(seal!.src, id).toContain("/330px-");
    }
  });
});
