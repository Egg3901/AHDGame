import { describe, it, expect } from "vitest";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { ERA_CONFIGS } from "@/components/landing/eraThemes";
import { RESET_PRESETS } from "@/lib/constants/historicalSeats";
import { SHIPPING_PRESETS, tierFor, isShippingPreset, ERA_ROSTER } from "./eraRoster";

/**
 * Edge cases and invariants the roster relies on but no single consumer checks.
 *
 * Several of these guard SILENT failures rather than loud ones — a mistyped
 * country id on the landing page does not error, it just makes the country stop
 * appearing, because `tierFor` returns the `absent` default and the derivation
 * drops it.
 */
describe("era roster invariants", () => {
  it("every curated landing nation id is a real CountryId", () => {
    // A typo would silently vanish: tierFor would return the `absent` default
    // and nationsFor would drop it, so the country just stops appearing.
    const all = new Set(Object.keys(COUNTRY_CONFIGS));
    for (const era of Object.values(ERA_CONFIGS)) {
      for (const nation of era.nations) expect(all, `${era.id}/${nation.id}`).toContain(nation.id);
    }
  });

  it("no latent country is in COUNTRY_ORDER, so the seeder's throw is unreachable", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const id of COUNTRY_ORDER) {
        expect(tierFor(preset, id), `${preset}/${id}`).not.toBe("latent");
      }
    }
  });

  it("isShippingPreset rejects the special presets and unknown ids", () => {
    expect(isShippingPreset("empty")).toBe(false);
    expect(isShippingPreset("2019-no-parties")).toBe(false);
    expect(isShippingPreset("1968-default")).toBe(false);
    expect(isShippingPreset("")).toBe(false);
    for (const p of SHIPPING_PRESETS) expect(isShippingPreset(p)).toBe(true);
  });

  it("the special presets still advertise no countries", () => {
    for (const id of ["empty", "2019-no-parties"]) {
      const entry = RESET_PRESETS.find((p) => p.id === id);
      expect(entry?.countries, id).toEqual([]);
    }
  });

  it("every preset keeps at least one player country", () => {
    // A world with nothing playable is not a world.
    for (const preset of SHIPPING_PRESETS) {
      const players = COUNTRY_ORDER.filter((c) => tierFor(preset, c) === "player");
      expect(players.length, preset).toBeGreaterThan(0);
    }
  });

  it("no roster entry names a country twice across tiers", () => {
    for (const preset of SHIPPING_PRESETS) {
      const s = ERA_ROSTER[preset];
      const all = [...(s.player ?? []), ...(s.econ ?? []), ...(s.npp ?? []), ...(s.latent ?? [])];
      expect(new Set(all).size, preset).toBe(all.length);
    }
  });

  it("vacantChambers only names chambers of countries live in that preset", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const key of ERA_ROSTER[preset].vacantChambers ?? []) {
        const [countryId] = key.split(".") as [CountryId];
        expect(tierFor(preset, countryId), `${preset}/${key}`).not.toBe("absent");
      }
    }
  });
});
