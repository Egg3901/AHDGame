import { describe, expect, it } from "vitest";
import type { Collection, Document } from "mongodb";
import { deleteRowsOfRemovedParties, loadResetPartySeedCatalog } from "./finalizeResetGameWorld";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
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

describe("removed-party row cleanup", () => {
  it("matches the party within its country, not by sequence number alone", async () => {
    // Bulgaria's party 3 was removed; Poland still has a party 3. The old
    // id-only filter kept Bulgaria's org rows because "3" was still in use.
    const mem = createInMemoryDb();
    mem.seed("statePartyOrg", [
      { _id: "BG_SOF_3", countryId: "BG", partyId: "3" },
      { _id: "PL_MAZ_3", countryId: "PL", partyId: "3" },
      { _id: "BG_SOF_1", countryId: "BG", partyId: "1" },
    ]);
    const deleted = await deleteRowsOfRemovedParties(
      mem.collection("statePartyOrg") as unknown as Collection<Document>,
      new Set(["BG:1", "PL:3"])
    );
    expect(deleted).toBe(1);
    expect(mem.collection("statePartyOrg").docs.map((row) => row._id)).toEqual([
      "PL_MAZ_3",
      "BG_SOF_1",
    ]);
  });
});
