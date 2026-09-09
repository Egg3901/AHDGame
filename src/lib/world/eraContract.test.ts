import { describe, expect, it } from "vitest";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { RESET_PRESETS } from "@/lib/constants/historicalSeats";
import { ERA_CONFIGS, type EraId } from "@/components/landing/eraThemes";
import { SHIPPING_PRESETS, tierFor, type ShippingPreset } from "./eraRoster";
import { getWorldEntityPresetManifest } from "./worldEntityManifest";

const eraOf = (preset: ShippingPreset): EraId => preset.slice(0, 4) as EraId;

/**
 * S6 — every consumer of era standing agrees with the roster.
 *
 * Before this, five authorities answered "what is this country in this era?"
 * independently and disagreed: the 1991 landing page advertised Germany as
 * playable while the manifest had it economy-only, and the admin reset picker
 * listed seven countries for a preset whose world contained sixteen.
 *
 * MECHANISM: pure comparison of derived consumers against `tierFor`. No DB, no
 * fallback machinery — each consumer is now computed from the roster, so these
 * assertions are about the derivation staying wired, not about hand-kept copies
 * staying in sync.
 */
describe("S6 — every roster consumer agrees with tierFor", () => {
  it("the world-entity manifest matches the roster for registered countries", () => {
    for (const preset of SHIPPING_PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      for (const country of COUNTRY_ORDER) {
        const tier = tierFor(preset, country);
        const entry = manifest.entries.find((e) => e.countryId === country);

        if (tier === "absent") {
          // Not a world entity in this era at all — omitted, not disabled.
          expect(entry, `${preset}/${country}`).toBeUndefined();
          continue;
        }
        const expected =
          tier === "player" ? "player" : tier === "econ" ? "economy-preview" : "hidden";
        expect(entry?.legacyAccess, `${preset}/${country}`).toBe(expected);
      }
    }
  });

  it("the landing accessMap matches the roster", () => {
    for (const preset of SHIPPING_PRESETS) {
      const config = ERA_CONFIGS[eraOf(preset)];
      for (const [country, access] of Object.entries(config.accessMap)) {
        const tier = tierFor(preset, country as CountryId);
        expect(access.enabledForPlayers, `${preset}/${country}`).toBe(tier === "player");
        expect(access.economyPreview, `${preset}/${country}`).toBe(tier === "econ");
      }
    }
  });

  it("the landing nations[].tier matches the roster", () => {
    // A SECOND display authority beside accessMap. Deriving only accessMap
    // would leave this free to drift in exactly the way S6 exists to prevent.
    for (const preset of SHIPPING_PRESETS) {
      for (const nation of ERA_CONFIGS[eraOf(preset)].nations) {
        expect(nation.tier, `${preset}/${nation.id}`).toBe(tierFor(preset, nation.id as CountryId));
      }
    }
  });

  it("the landing page never advertises a country absent from the era", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const nation of ERA_CONFIGS[eraOf(preset)].nations) {
        expect(tierFor(preset, nation.id as CountryId), `${preset}/${nation.id}`).not.toBe(
          "absent"
        );
      }
    }
  });

  it("the admin reset picker matches the roster, for presets it defines", () => {
    // Derived only for preset ids RESET_PRESETS already carries: there is no
    // 1999-default or 2007-default entry, and /api/admin/reset/presets returns
    // this array verbatim, so generating them would add two resets to the admin
    // picker as a side effect of a consistency check.
    for (const entry of RESET_PRESETS) {
      if (!(SHIPPING_PRESETS as readonly string[]).includes(entry.id)) continue;
      const preset = entry.id as ShippingPreset;
      const live = COUNTRY_ORDER.filter((c) => tierFor(preset, c) !== "absent");
      expect([...entry.countries].sort(), entry.id).toEqual([...live].sort());
    }
  });

  it("every shipping preset has a sphere-sponsor set", () => {
    // 2023-default had none, so isManifestSphereSponsor returned false for every
    // country in that preset and nothing could sponsor a sphere there.
    for (const preset of SHIPPING_PRESETS) {
      const manifest = getWorldEntityPresetManifest(preset);
      expect(
        manifest.entries.some((e) => e.sphere.canSponsor),
        preset
      ).toBe(true);
    }
  });

  it("no absent country is sphere-sponsor eligible", () => {
    // Future-proofing, and currently vacuous: the eligibility sets only hold
    // US/UK/RU/FR/CN/DE/JP, none of which is absent anywhere. It exists so the
    // pairing cannot silently break when either side changes.
    for (const preset of SHIPPING_PRESETS) {
      for (const entry of getWorldEntityPresetManifest(preset).entries) {
        if (!entry.countryId || tierFor(preset, entry.countryId) !== "absent") continue;
        expect(entry.sphere.canSponsor, `${preset}/${entry.countryId}`).toBe(false);
      }
    }
  });
});
