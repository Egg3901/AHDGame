import { describe, it, expect } from "vitest";
import { deRegions1953 } from "@/lib/seeds/de/deRegions1953";
import { DE_WAHLKREIS_SEATS } from "@/lib/constants/states";
import { getCountryConfig } from "@/lib/constants/countries";

/**
 * Regression coverage for issue #3901: a fresh 1953 founding world measured
 * DE at 1,931 seats held vs 1,691 "configured" (114%) — the only country in
 * the world off by more than 10%, while everyone else sat at 97-101%.
 *
 * Investigation (mongosh against a finished 1953 reference sandbox,
 * countryId: "DE"):
 *
 *   electedOfficials (seats HELD, {$sum: {$ifNull: ["$seatsHeld", 1]}}):
 *     landtag           1,429
 *     bundestag           491
 *     ministerPresident    11
 *
 *   elections cycle 0 (naive "configured", Σ totalSeats):
 *     landtag           1,429   <- EXACT match, not the bug
 *     bundestag           251   <- direct-mandate (Wahlkreis) tier only
 *     ministerPresident    11   <- EXACT match, not the bug
 *
 * Landtag and Minister-President are seated exactly to their configured
 * totals — #3901's hypothesis that `germanyLandtag.ts` was over-seating
 * does not hold up under measurement. The entire 240-seat "surplus" lives
 * in the Bundestag row, and it is not a seat-allocation bug either: DE's
 * Bundestag is an AMS/MMP system (electionSystems.lowerChamber: "ams"). The
 * `elections` collection only ever carries `totalSeats` for the
 * direct-mandate (Wahlkreis) tier — one Election doc per Land, sized from
 * DE_WAHLKREIS_SEATS (electionSpawning.ts / perpetualElections.ts). The
 * list tier is never backed by its own Election doc; it's computed once
 * nationally by germanyAMS.ts's federal Sainte-Laguë allocation, sized by
 * the era-aware `getLiveLowerChamberSeats` (lowerChamberSeats.ts, fixed by
 * #3900 for issue #3896). So summing `elections.totalSeats` for bundestag
 * structurally undercounts DE's true chamber target by exactly the list
 * tier's size — a gap that doesn't exist for any other country's chamber,
 * because AMS is the only list-tier method in the game (isListTierMethod,
 * electionMethod.ts) and every other country's `elections.totalSeats` sum
 * IS the whole chamber.
 *
 * Using the correct era-aware target (487, COUNTRY_CONFIGS.DE.legislature.
 * lowerChamber under 1953-default) instead of the direct-mandate-only 251:
 *
 *   configured: 1,429 (landtag) + 11 (ministerPresident) + 487 (bundestag) = 1,927
 *   held:       1,429 (landtag) + 11 (ministerPresident) + 491 (bundestag) = 1,931
 *   1,931 / 1,927 = 100.2% — in line with the rest of the world (97-101%).
 *
 * The 4-seat bundestag gap (491 held vs 487 target) is expected overhang
 * mandates for an AMS system, already established by #3896/#3900.
 *
 * This test locks in the arithmetic so a future change to the Wahlkreis
 * map, the 1953 Land roster, or the era's chamber-size config can't
 * silently reopen the same false-positive audit gap — and so nobody has to
 * re-derive this investigation from scratch.
 */
describe("DE 1953 seat accounting (issue #3901)", () => {
  it("has exactly the 11 FRG-only Länder for a 1953 world (no eastern Länder)", () => {
    expect(deRegions1953).toHaveLength(11);
  });

  it("Wahlkreis direct-mandate sum for the 1953 Länder is 251, not the modern 299", () => {
    const directMandateSum = deRegions1953.reduce(
      (sum, land) => sum + (DE_WAHLKREIS_SEATS[land._id as string] ?? 0),
      0
    );
    expect(directMandateSum).toBe(251);
  });

  it("landtag configured seats (Σ stateSenateSeats) is what the Landtag resolver seats exactly", () => {
    const landtagConfigured = deRegions1953.reduce(
      (sum, land) => sum + (land.stateSenateSeats ?? 0),
      0
    );
    expect(landtagConfigured).toBe(1429);
  });

  it("the true Bundestag target minus the direct-mandate tier plus expected overhang accounts for the full apparent surplus", () => {
    const directMandateSum = deRegions1953.reduce(
      (sum, land) => sum + (DE_WAHLKREIS_SEATS[land._id as string] ?? 0),
      0
    );
    const landtagConfigured = deRegions1953.reduce(
      (sum, land) => sum + (land.stateSenateSeats ?? 0),
      0
    );
    const ministerPresidentSeats = deRegions1953.length; // one MP election per Land

    const trueBundestagTarget = getCountryConfig("DE", "1953-default").legislature.lowerChamber
      .seats;
    expect(trueBundestagTarget).toBe(487);

    // What #3901's reproduction recipe measures (Σ elections.totalSeats).
    const naiveConfiguredTotal = landtagConfigured + ministerPresidentSeats + directMandateSum;
    expect(naiveConfiguredTotal).toBe(1691);

    // What the reference sandbox actually held (measured via mongosh).
    const observedOverhang = 4; // 491 held vs 487 target — expected, per #3896/#3900
    const bundestagHeld = trueBundestagTarget + observedOverhang;
    const actualHeld = landtagConfigured + ministerPresidentSeats + bundestagHeld;
    expect(actualHeld).toBe(1931);

    // The naive "114%" is fully explained by the missing list tier + overhang.
    expect(actualHeld - naiveConfiguredTotal).toBe(240);

    // Measured against the TRUE configured total, DE lands in line with the
    // rest of the world (97-101%), not at 114%.
    const trueConfiguredTotal = landtagConfigured + ministerPresidentSeats + trueBundestagTarget;
    expect(trueConfiguredTotal).toBe(1927);
    expect(actualHeld / trueConfiguredTotal).toBeCloseTo(1.002, 3);
  });
});
