import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { SHIPPING_PRESETS, tierFor } from "@/lib/world/eraRoster";
import {
  getPresetEnablementCountries,
  getPresetEnablementTier,
  seedCountryGameStates,
} from "./seedCountryGameStates";

describe("manifest-backed preset country enablement", () => {
  it("preserves the 1953 player, economy-preview, and hidden tiers", () => {
    expect(getPresetEnablementTier("1953-default", "UK")).toEqual({
      enabledForPlayers: true,
      economyPreview: false,
      status: "active",
    });
    // FR was re-promoted to economy-preview Tier 1 after false #3723 demotion.
    expect(getPresetEnablementTier("1953-default", "FR")).toEqual({
      enabledForPlayers: false,
      economyPreview: true,
      status: "beta",
    });
    expect(getPresetEnablementTier("1953-default", "JP")).toEqual({
      enabledForPlayers: false,
      economyPreview: true,
      status: "beta",
    });
    expect(getPresetEnablementTier("1953-default", "NG")).toEqual({
      enabledForPlayers: false,
      economyPreview: true,
      status: "beta",
    });
    // Ireland is non-playable but its Tier-1 sectors remain investable in 1953.
    expect(getPresetEnablementTier("1953-default", "IE")).toEqual({
      enabledForPlayers: false,
      economyPreview: true,
      status: "beta",
    });
    expect(getPresetEnablementTier("1953-default", "PL")).toEqual({
      enabledForPlayers: false,
      economyPreview: true,
      status: "beta",
    });
  });

  /**
   * Regression lock for the product decision of 2026-07-25 (#3712/#3723): the
   * Warsaw Pact six + Nigeria are Tier-1 full-autonomous in 1953. Every piece
   * of machinery behind them — `ensureEasternBlocAssemblyElections`,
   * `ensureNGElections`, `BLOC_CHAMBERS_1953` — is gated on
   * `countryGameStates.status ∈ {beta, active}` via `getCountryAccessFromDb`.
   * If the manifest ever regresses these entries to `hidden`, the seeder writes
   * `coming-soon` and every one of those spawners silently no-ops, exactly as
   * the pre-#3747 production world did. Assert all seven, not just PL.
   */
  it("seeds the Warsaw Pact six + Nigeria at the beta tier that unblocks their spawners", () => {
    for (const countryId of ["PL", "CS", "HU", "RO", "BG", "YU", "NG"] as const) {
      expect(getPresetEnablementTier("1953-default", countryId), countryId).toEqual({
        enabledForPlayers: false,
        economyPreview: true,
        status: "beta",
      });
    }
  });

  it("keeps US out of countryGameStates because it uses global GameState", () => {
    expect(getPresetEnablementTier("1953-default", "US")).toBeNull();
    expect(getPresetEnablementCountries("1953-default")).not.toContain("US");
  });

  /**
   * DELIBERATE REVERSAL. 2019 and 2023 used to return null so admin-managed
   * rows survived a reset. That is how 2019 drifted into six player countries
   * instead of three, so the roster now answers for every shipping preset.
   */
  it("no longer defers 2019 and 2023 to the config/admin fallback", () => {
    for (const preset of ["2019-default", "2023-default"] as const) {
      expect(getPresetEnablementCountries(preset), preset).not.toBeNull();
      expect(getPresetEnablementTier(preset, "UK"), preset).toEqual({
        enabledForPlayers: true,
        economyPreview: false,
        status: "active",
      });
    }
  });

  it("still writes no rows for the presets that seed no era", () => {
    for (const preset of ["empty", "2019-no-parties"] as const) {
      expect(getPresetEnablementCountries(preset), preset).toBeNull();
      expect(getPresetEnablementTier(preset, "UK"), preset).toBeNull();
    }
  });

  it("fails loudly for an unclassified preset", () => {
    // A typo must not become a silent no-op reset.
    expect(() => getPresetEnablementCountries("1968-default")).toThrow(/No world entity roster/);
  });

  it("seeds 1953 player countries when the readiness contract passes", async () => {
    const db = createMockDb();
    db.collection("countryGameStates");
    db.collectionMocks.countryGameStates!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    });
    await seedCountryGameStates(db as unknown as Db, "1953-default", 1953);
    expect(db.collectionMocks.countryGameStates!.updateOne).toHaveBeenCalled();
    const playerWrites = db.collectionMocks.countryGameStates!.updateOne.mock.calls.filter(
      (call) => call[1].$set.enabledForPlayers === true
    );
    expect(playerWrites.map((call) => call[0]._id).sort()).toEqual(["DD", "RU", "UK"]);
  });
});

describe("roster-driven enablement", () => {
  function collectWrites() {
    const db = createMockDb();
    db.collection("countryGameStates");
    db.collectionMocks.countryGameStates!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    });
    const writes = () =>
      db.collectionMocks.countryGameStates!.updateOne.mock.calls.map((call) => ({
        id: String(call[0]._id),
        set: call[1].$set as Record<string, unknown>,
      }));
    return { db, writes };
  }

  it("writes a row for every registered country except the US", async () => {
    const { db, writes } = collectWrites();
    await seedCountryGameStates(db as unknown as Db, "2019-default", 2019);
    expect(
      writes()
        .map((w) => w.id)
        .sort()
    ).toEqual(
      COUNTRY_ORDER.filter((c) => c !== "US")
        .map(String)
        .sort()
    );
  });

  it("marks DD absentInEra in 2019 and clears it in 1953", async () => {
    const a = collectWrites();
    await seedCountryGameStates(a.db as unknown as Db, "2019-default", 2019);
    expect(a.writes().find((w) => w.id === "DD")!.set).toMatchObject({
      absentInEra: true,
      enabledForPlayers: false,
      economyPreview: false,
    });

    const b = collectWrites();
    await seedCountryGameStates(b.db as unknown as Db, "1953-default", 1953);
    expect(b.writes().find((w) => w.id === "DD")!.set).toMatchObject({
      absentInEra: false,
      enabledForPlayers: true,
    });
  });

  it("opens JP to players in 1991 and 2019", async () => {
    for (const preset of ["1991-default", "2019-default"] as const) {
      const { db, writes } = collectWrites();
      await seedCountryGameStates(db as unknown as Db, preset, 2019);
      expect(writes().find((w) => w.id === "JP")!.set, preset).toMatchObject({
        enabledForPlayers: true,
        status: "active",
      });
    }
  });

  it("keeps the Warsaw Pact six at beta in 1953 so their spawners still fire", async () => {
    // Regression lock, same as the manifest-era test above: every spawner behind
    // these is gated on status in {beta, active}.
    const { db, writes } = collectWrites();
    await seedCountryGameStates(db as unknown as Db, "1953-default", 1953);
    for (const id of ["PL", "CS", "HU", "RO", "BG", "YU"]) {
      expect(writes().find((w) => w.id === id)!.set, id).toMatchObject({
        enabledForPlayers: false,
        economyPreview: true,
        status: "beta",
      });
    }
  });

  it("never writes a US row", async () => {
    const { db, writes } = collectWrites();
    await seedCountryGameStates(db as unknown as Db, "1991-default", 1991);
    expect(writes().find((w) => w.id === "US")).toBeUndefined();
  });

  it("writes nothing for the presets that seed no era", async () => {
    for (const preset of ["empty", "2019-no-parties"] as const) {
      const { db, writes } = collectWrites();
      await seedCountryGameStates(db as unknown as Db, preset, 2019);
      expect(writes(), preset).toEqual([]);
    }
  });

  it("refuses an unrecognised preset rather than silently seeding nothing", async () => {
    const { db } = collectWrites();
    await expect(seedCountryGameStates(db as unknown as Db, "1968-default", 1968)).rejects.toThrow(
      /No world entity roster/
    );
  });
});

/**
 * The enablement accessors answer "what does this preset contain?", and callers
 * such as `seededCountryIdsForPreset` treat the answer as "what a reset
 * produces". A country the era does not contain belongs in neither.
 *
 * The pre-roster implementation got this for free: it read world-entity
 * manifest entries, and an absent country has none. Deriving from COUNTRY_ORDER
 * lost that, silently.
 */
describe("enablement accessors exclude countries the era does not contain", () => {
  it("omits East Germany from 1991 and later", () => {
    for (const preset of [
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
    ] as const) {
      expect(getPresetEnablementCountries(preset), preset).not.toContain("DD");
      expect(getPresetEnablementTier(preset, "DD"), preset).toBeNull();
    }
  });

  it("keeps East Germany in the Cold-War presets", () => {
    for (const preset of ["1953-default", "1979-default"] as const) {
      expect(getPresetEnablementCountries(preset), preset).toContain("DD");
      expect(getPresetEnablementTier(preset, "DD"), preset).not.toBeNull();
    }
  });

  it("omits Czechoslovakia and Yugoslavia once they have dissolved", () => {
    expect(getPresetEnablementCountries("2019-default")).not.toContain("CS");
    expect(getPresetEnablementCountries("2019-default")).not.toContain("YU");
    // Yugoslavia as Serbia and Montenegro survives to 2006, so 1999 keeps it.
    expect(getPresetEnablementCountries("1999-default")).toContain("YU");
  });

  it("returns exactly the non-absent registered countries", () => {
    for (const preset of SHIPPING_PRESETS) {
      const expected = COUNTRY_ORDER.filter(
        (id) => id !== "US" && tierFor(preset, id) !== "absent"
      );
      expect(getPresetEnablementCountries(preset), preset).toEqual(expected);
    }
  });
});
