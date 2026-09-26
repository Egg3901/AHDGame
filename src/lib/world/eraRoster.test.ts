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
  it("does not advertise unauthored modern successor-country substrates in 2027", () => {
    for (const countryId of ["RU", "PL", "HU", "RO", "BG"] as const) {
      expect(tierFor("2027-default", countryId), countryId).toBe("absent");
    }
  });

  it("covers every CountryId across every shipping preset", () => {
    expect(ALL).toHaveLength(29);
    // Deliberate tripwires, not incidental. Adding a preset or a country should
    // fail here first, so whoever adds one is made to check that the roster
    // covers it rather than letting `tierFor` quietly answer "absent" forever.
    // 2027 took this from seven to eight.
    expect(SHIPPING_PRESETS).toHaveLength(8);
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

/**
 * The roster is replacing the world-entity manifest as the source of era
 * standing, so before anything derives from it, it has to be a FAITHFUL
 * replacement: identical to the manifest everywhere except where this
 * sub-project deliberately changes the answer.
 *
 * This caught three real defects when it was first written — the 1953 Warsaw
 * Pact six demoted from economy-preview to npp (which would have silently
 * no-opped every one of their election spawners, all gated on
 * `status in {beta, active}`), Spain promoted out of its 1953 sphere-macro
 * demotion, and eight European countries demoted across 1999/2007. All three
 * came from hand-writing tiers instead of deriving them.
 */
describe("roster is a faithful replacement for the manifest", () => {
  /** Divergences this sub-project intends. Anything else is a defect. */
  const INTENDED = new Set<string>([
    // Japan is promoted to player in every modern preset (spec §2.1(1)).
    "1991-default/JP",
    "1999-default/JP",
    "2007-default/JP",
  ]);

  it("matches the manifest except where a change is declared", async () => {
    const { getWorldEntityPresetManifest } = await import("./worldEntityManifest");
    const divergences: string[] = [];

    for (const preset of SHIPPING_PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      // 2019/2023 manifests are entirely `config-fallback` — era-blind, and the
      // defect this sub-project exists to fix. Nothing to compare against.
      if (manifest.entries.every((e) => e.legacyAccess === "config-fallback")) continue;

      for (const country of COUNTRY_ORDER) {
        const entry = manifest.entries.find((e) => e.countryId === country);
        // A country the manifest omits entirely is one of the gaps being
        // closed; the roster classifying it is the point.
        if (!entry) continue;
        // A dissolved state is recorded by the manifest and absent from the
        // roster on purpose: the row is history, the tier is playability. They
        // are answering different questions, so this is not a divergence.
        if (entry.status === "dissolved") continue;

        const tier = tierFor(preset, country);
        const expected =
          tier === "player"
            ? "player"
            : tier === "econ"
              ? "economy-preview"
              : tier === "npp"
                ? "hidden"
                : null;
        if (expected !== entry.legacyAccess && !INTENDED.has(`${preset}/${country}`)) {
          divergences.push(`${preset}/${country}: roster=${tier} manifest=${entry.legacyAccess}`);
        }
      }
    }

    expect(divergences).toEqual([]);
  });
});
