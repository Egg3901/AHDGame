import { describe, expect, it } from "vitest";
import { expectedRegionCount } from "@/lib/admin/seedDiagnostic/regionBundles";
import { SHIPPING_PRESETS } from "@/lib/world/eraRoster";
import type { CountryId } from "./countries";
import { COUNTRY_READINESS_EXPECTATIONS } from "./countryReadinessExpectations";
import { getReadinessExpectations } from "./readinessExpectations";

describe("getReadinessExpectations", () => {
  it("returns null for a country with no authored entry", () => {
    expect(getReadinessExpectations("SCO", "2019-default")).toBeNull();
  });

  /**
   * Faithful replacement. A derivation that silently changes what the game
   * already expects is a defect, not a refactor, and only a pinned comparison
   * makes that visible. This is the technique that caught the roster/manifest
   * divergence in Plan A.
   *
   * The baseline is what `buildCountryReadinessReport` computes today, NOT the
   * raw authored entry: that function has preferred `expectedRegionCount(id,
   * preset)` over the authored `regionCount` since era-awareness was added to
   * it, falling back to the entry only when no preset resolves. Pinning against
   * the raw entry would assert a number production stopped using.
   *
   * Japan and Brazil are why this distinction matters. Their entries claim 47
   * prefectures and 27 states while `jpRegions` and `brRegions` seed 8 and 5, so
   * the two baselines genuinely disagree, in every era. The seed bundle is the
   * truth for a diagnostic that counts seeded rows.
   *
   * `partyRoster` and `partyMin` are deliberately not pinned: the authored
   * roster is prose ("Democratic, Republican") and the derived one is
   * abbreviations read from the seed modules. The cases below assert the derived
   * roster's behaviour instead.
   */
  it("reproduces what the admin report already computes, for every preset", () => {
    for (const preset of SHIPPING_PRESETS) {
      for (const id of Object.keys(COUNTRY_READINESS_EXPECTATIONS) as CountryId[]) {
        const authored = COUNTRY_READINESS_EXPECTATIONS[id]!;
        const derived = getReadinessExpectations(id, preset)!;
        const eraRegions = expectedRegionCount(id, preset);
        const where = `${preset}/${id}`;

        expect(derived.regionCount, where).toBe(eraRegions ?? authored.regionCount);
        expect(derived.demographicsCount, where).toBe(eraRegions ?? authored.demographicsCount);
        expect(derived.stateMetricsCount, where).toBe(eraRegions ?? authored.stateMetricsCount);

        // Everything else is judgment, not a count, and passes through
        // untouched — except where SEAT_MIN_BY_PRESET records that an era's
        // chambers are a different size than the authored entry assumes. Japan
        // in 1991 is the only such case: a 764-seat Diet measured against the
        // modern 713 could not see a missing fifth of its upper house.
        const seatOverride = preset === "1991-default" && id === "JP";
        expect(derived.seatMin, where).toBe(seatOverride ? 764 : authored.seatMin);
        expect(derived.seatNote, where).toBe(
          seatOverride
            ? "Expected ≥764 (512 Shugiin + 252 Sangiin, pre-1994 Diet)"
            : authored.seatNote
        );
        expect(derived.nppMin, where).toBe(authored.nppMin);
        expect(derived.officialMin, where).toBe(authored.officialMin);
        expect(derived.statePartyOrgMin, where).toBe(authored.statePartyOrgMin);
        expect(derived.legislationTypesMin, where).toBe(authored.legislationTypesMin);
        expect(derived.stateMetricsFilter, where).toEqual(authored.stateMetricsFilter);
      }
    }
  });

  it("tracks Germany's region count across reunification", () => {
    // 11 western Laender before 1990, 16 after. A flat expectation reports a
    // correct 1953 seed as incomplete.
    expect(getReadinessExpectations("DE", "1953-default")!.regionCount).toBe(11);
    expect(getReadinessExpectations("DE", "1991-default")!.regionCount).toBe(16);
  });

  it("stops asserting the CPSU in a post-Soviet world", () => {
    // The defect this whole task exists for: RU passed partiesAuthored in 2019
    // by asserting a party whose seeds are gated to 1953 and 1979.
    const soviet = getReadinessExpectations("RU", "1979-default")!;
    const modern = getReadinessExpectations("RU", "2019-default")!;
    expect(soviet.partyRoster).toContain("CPSU");
    expect(modern.partyRoster).not.toContain("CPSU");
    expect(modern.partyMin).toBe(0);
  });

  it("empties the roster for a country the era does not contain", () => {
    const dd = getReadinessExpectations("DD", "2019-default")!;
    expect(dd.partyMin).toBe(0);
    expect(dd.partyRoster).toBe("");
  });

  it("keeps the authored region count where no era bundle is registered", () => {
    // Poland has no FULL_ERA_REGION_BUNDLES entry, so expectedRegionCount
    // returns null and the authored number stands rather than collapsing to 0.
    const authored = COUNTRY_READINESS_EXPECTATIONS.PL!;
    expect(getReadinessExpectations("PL", "1953-default")!.regionCount).toBe(authored.regionCount);
  });

  it("preserves an authored offset between region and demographic counts", () => {
    // RU carries 17 regions but 14 demographic rows, because Ukraine,
    // Byelorussia and the Baltics are checked under their own entries. The
    // offset must survive derivation rather than being flattened.
    const authored = COUNTRY_READINESS_EXPECTATIONS.RU!;
    const derived = getReadinessExpectations("RU", "1979-default")!;
    expect(authored.regionCount - authored.demographicsCount).toBe(3);
    expect(derived.regionCount - derived.demographicsCount).toBe(3);
  });
});
