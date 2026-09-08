import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import {
  countriesByTier,
  ERA_ROSTER,
  isRegisteredTier,
  SHIPPING_PRESETS,
  tierFor,
} from "./eraRoster";

const ALL = Object.keys(COUNTRY_CONFIGS) as CountryId[];

describe("S1 — era roster totality", () => {
  it("covers every CountryId across every shipping preset", () => {
    expect(ALL).toHaveLength(29);
    expect(SHIPPING_PRESETS).toHaveLength(7);
    for (const preset of SHIPPING_PRESETS) {
      for (const country of ALL) {
        expect(["player", "econ", "npp", "latent", "absent"]).toContain(tierFor(preset, country));
      }
    }
  });

  it("never names a country in two tiers of the same preset", () => {
    for (const preset of SHIPPING_PRESETS) {
      const spec = ERA_ROSTER[preset];
      const named = [
        ...(spec.player ?? []),
        ...(spec.econ ?? []),
        ...(spec.npp ?? []),
        ...(spec.latent ?? []),
      ];
      expect(new Set(named).size, preset).toBe(named.length);
    }
  });

  it("only names real CountryIds", () => {
    for (const preset of SHIPPING_PRESETS) {
      const spec = ERA_ROSTER[preset];
      for (const id of [
        ...(spec.player ?? []),
        ...(spec.econ ?? []),
        ...(spec.npp ?? []),
        ...(spec.latent ?? []),
      ]) {
        expect(ALL, `${preset}/${id}`).toContain(id);
      }
    }
  });

  it("registered tiers are in COUNTRY_ORDER; latent and absent are not", () => {
    // The roster must AGREE with the registered set, in both directions.
    //
    // Earlier drafts asserted "non-absent implies registered", which read the
    // UKR/BLR/BAL latency as a bug and would have registered three countries
    // that are held back on purpose — see `countryLatency.test.ts` and
    // `scoWalInvisibility.test.ts`, which state they "ship at Poland's standing:
    // seeded and visible on the world map, not yet offered to players".
    const shouldBeRegistered: string[] = [];
    const shouldNotBeRegistered: string[] = [];
    for (const preset of SHIPPING_PRESETS) {
      for (const country of ALL) {
        const registered = COUNTRY_ORDER.includes(country);
        if (isRegisteredTier(tierFor(preset, country)) && !registered) {
          shouldBeRegistered.push(`${preset}/${country}`);
        }
        if (tierFor(preset, country) === "latent" && registered) {
          shouldNotBeRegistered.push(`${preset}/${country}`);
        }
      }
    }
    expect(shouldBeRegistered).toEqual([]);
    expect(shouldNotBeRegistered).toEqual([]);
  });

  it("latent means seeded but unregistered — UKR/BLR/BAL in the Cold-War eras only", () => {
    // The Warsaw-Pact seed pack runs behind `isEasternBlocEra`, so these three
    // are written in 1953/1979 and nowhere else. Absent later is therefore about
    // presence in the world, not a claim they stopped existing.
    for (const preset of ["1953-default", "1979-default"] as const) {
      expect([...countriesByTier(preset, "latent")].sort(), preset).toEqual(["BAL", "BLR", "UKR"]);
    }
    for (const preset of ["1991-default", "2019-default"] as const) {
      expect(countriesByTier(preset, "latent"), preset).toEqual([]);
      for (const id of ["UKR", "BLR", "BAL"] as const) {
        expect(tierFor(preset, id), `${preset}/${id}`).toBe("absent");
      }
    }
  });

  it("US, UK and JP are the player countries in 1991 and 2019", () => {
    for (const preset of ["1991-default", "2019-default"] as const) {
      expect([...countriesByTier(preset, "player")].sort(), preset).toEqual(["JP", "UK", "US"]);
    }
  });

  it("DD is absent after reunification and present in the divided eras", () => {
    expect(tierFor("1991-default", "DD")).toBe("absent");
    expect(tierFor("2019-default", "DD")).toBe("absent");
    expect(tierFor("1953-default", "DD")).not.toBe("absent");
    expect(tierFor("1979-default", "DD")).not.toBe("absent");
  });

  it("RU existed in 1991 — npp, never absent", () => {
    // `absent` is a claim the polity did not exist. Russia plainly did; the
    // missing 1991 seed data is a deferred waiver, not non-existence.
    expect(tierFor("1991-default", "RU")).toBe("npp");
  });

  it("dissolved federations go absent from the preset after they ceased", () => {
    // CS dissolved 31 Dec 1992; YU, as Serbia and Montenegro, survived to 2006.
    // Both are registered countries, so they step from `npp` to `absent`.
    // (BAL is not here: it is unregistered, so it steps from `latent` to
    // `absent` instead — covered by the latent case above.)
    expect(tierFor("1991-default", "CS")).toBe("npp");
    expect(tierFor("1999-default", "CS")).toBe("absent");

    expect(tierFor("1991-default", "YU")).toBe("npp");
    expect(tierFor("1999-default", "YU")).toBe("npp");
    expect(tierFor("2007-default", "YU")).toBe("absent");
  });

  it("SCO and WAL are absent everywhere — latent until secession actuates", () => {
    for (const preset of SHIPPING_PRESETS) {
      expect(tierFor(preset, "SCO"), preset).toBe("absent");
      expect(tierFor(preset, "WAL"), preset).toBe("absent");
    }
  });
});
