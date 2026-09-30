import { describe, expect, it } from "vitest";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { SHIPPING_PRESETS, tierFor } from "@/lib/world/eraRoster";
import { PARTY_SEED_MODULES, partySeedsForPreset } from "./partySeedRegistry";

describe("party seed registry", () => {
  it("covers every registered country", () => {
    // The US seeds through politicalParties.ts rather than a us/usParties.ts,
    // so it is registered here under the same key as everyone else.
    for (const id of COUNTRY_ORDER) {
      expect(PARTY_SEED_MODULES[id], id).toBeDefined();
    }
  });

  it("every seed it returns declares the preset it was asked for", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const id of COUNTRY_ORDER) {
        for (const seed of partySeedsForPreset(id, preset)) {
          if (!seed.validForPresets) continue;
          expect(seed.validForPresets, `${preset}/${id}/${seed.name}`).toContain(preset);
        }
      }
    }
  });

  it("returns no party for a country the era does not contain", () => {
    // East Germany after reunification is the reference case: ddParties are all
    // gated to the Cold-War presets, so the era filter alone empties the list.
    expect(partySeedsForPreset("DD", "2019-default")).toEqual([]);
    expect(partySeedsForPreset("DD", "1979-default").length).toBeGreaterThan(0);
  });

  it("gives every live player country at least one party in every era", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const id of COUNTRY_ORDER) {
        if (tierFor(preset, id) !== "player") continue;
        expect(partySeedsForPreset(id, preset).length, `${preset}/${id}`).toBeGreaterThan(0);
      }
    }
  });

  it("starts the January 1991 successor roster with organizations that already existed", () => {
    const russian = partySeedsForPreset("RU", "1991-default");
    const yugoslav = partySeedsForPreset("YU", "1991-default");
    expect(russian.map((party) => party.name)).toContain("Democratic Party of Russia");
    expect(russian.map((party) => party.name)).not.toContain(
      "Liberal Democratic Party of the Soviet Union"
    );
    expect(yugoslav.find((party) => party.regimeStatus === "ruling")?.name).toBe(
      "Alliance of Reform Forces of Yugoslavia"
    );
    expect(yugoslav.map((party) => party.name)).toContain("League of Communists of Montenegro");
    expect(yugoslav.map((party) => party.name)).not.toContain(
      "Democratic Party of Socialists of Montenegro"
    );
  });

  it("keeps the five 2019 transition countries out of Soviet and later rosters", () => {
    for (const countryId of ["RU", "PL", "HU", "RO", "BG"] as const) {
      const parties = partySeedsForPreset(countryId, "2019-default");
      expect(parties.length, countryId).toBeGreaterThan(0);
      expect(parties.every((party) => party.validForPresets?.includes("2019-default"))).toBe(true);
      expect(parties.every((party) => party.regimeStatus !== "ruling")).toBe(true);
    }
    expect(partySeedsForPreset("RU", "2019-default").map((party) => party.abbreviation))
      .toContain("ER");
    expect(partySeedsForPreset("RU", "2019-default").map((party) => party.abbreviation))
      .not.toContain("CPSU");
    expect(partySeedsForPreset("PL", "2019-default").map((party) => party.abbreviation))
      .not.toContain("TD");
  });
});
