import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
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

  it("preserves the 2019 config/admin fallback", () => {
    expect(getPresetEnablementCountries("2019-default")).toBeNull();
    expect(getPresetEnablementTier("2019-default", "UK")).toBeNull();
  });

  it("preserves config fallback country enablement for the 2023 preset", () => {
    expect(getPresetEnablementCountries("2023-default")).toBeNull();
    expect(getPresetEnablementTier("2023-default", "UK")).toBeNull();
  });

  it("fails loudly for an unclassified preset", () => {
    expect(() => getPresetEnablementCountries("1968-default")).toThrow(/No world entity manifest/);
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
