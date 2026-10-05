import { describe, expect, it } from "vitest";
import { loadResetPartySeedCatalog } from "./finalizeResetGameWorld";
import { presetMismatchedPartyNames } from "@/lib/seeds/ensureDefaultParties";
import { partySeedsForPreset } from "@/lib/seeds/partySeedRegistry";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

describe("reset era cleanup party catalog", () => {
  it("keeps Bulgaria's 1991 Movement for Rights and Freedoms on a 1991 reset", async () => {
    // Seeded for 1991 by the successor roster; the same name is a 2027-only
    // seed, so a catalog without the successor roster deleted it every reset.
    const mismatched = presetMismatchedPartyNames(
      await loadResetPartySeedCatalog(),
      "1991-default",
      new Set(["BG"])
    );
    expect(mismatched).not.toContainEqual({
      countryId: "BG",
      name: "Movement for Rights and Freedoms",
    });
  });

  it.each(["1991-default", "2019-default", "1953-default"])(
    "never removes a party the %s bootstrap seeds",
    async (preset) => {
      const countries = Object.keys(COUNTRY_CONFIGS) as CountryId[];
      const mismatched = presetMismatchedPartyNames(
        await loadResetPartySeedCatalog(),
        preset,
        new Set(countries)
      );
      const removed = new Set(mismatched.map(({ countryId, name }) => `${countryId}:${name}`));
      const seeded = countries.flatMap((countryId) =>
        partySeedsForPreset(countryId, preset).map((seed) => `${countryId}:${seed.name}`)
      );
      expect(seeded.filter((key) => removed.has(key))).toEqual([]);
    }
  );
});
