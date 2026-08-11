/**
 * The gate for spec step 4. With the authored defense boards merged in, a real
 * non-playable seed must leave NOTHING unauthored. If this starts reporting
 * unauthored families, either a legacy seed lost a metric the derivation
 * depended on or a country is missing from the defense table — and that country
 * would otherwise ship with an incomplete board.
 */
import { describe, expect, it } from "vitest";
import { deriveCountryBoard } from "./deriveFamilies";
import { FAMILY_SLUGS } from "../types";

const DEFENSE_FAMILIES = FAMILY_SLUGS.defense.map((s) => `defense.${s}`);

/** Flatten a seed doc to "category.metricId" → value. */
function flatten(doc: Record<string, unknown>): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [category, metrics] of Object.entries(doc)) {
    if (typeof metrics !== "object" || metrics == null) continue;
    for (const [metricId, mv] of Object.entries(metrics as Record<string, unknown>)) {
      const v = (mv as { value?: number })?.value;
      if (typeof v === "number" && Number.isFinite(v)) flat[`${category}.${metricId}`] = v;
    }
  }
  return flat;
}

async function jpBoard() {
  const { jpStateMetrics } = await import("@/lib/seeds/jp/jpStateMetrics");
  const legacy = flatten(jpStateMetrics[0] as unknown as Record<string, unknown>);
  // A real seed carries economic/population in the SAME doc (pre-split source),
  // so the same flat map serves as both halves here.
  return deriveCountryBoard({ countryId: "JP", legacy, macro: legacy });
}

describe("non-playable derivation coverage", () => {
  it("leaves NOTHING unauthored for a real seed", async () => {
    const board = await jpBoard();
    expect(board.unauthored).toEqual([]);
  });

  it("sources the defense block from the authored table (tier 4)", async () => {
    const board = await jpBoard();
    for (const id of DEFENSE_FAMILIES) {
      expect(board.values[id]?.tier, id).toBe(4);
      expect(board.values[id]?.sources, id).toEqual(["authored"]);
    }
  });

  it("emits all 63 families, all finite and in 0-100", async () => {
    const board = await jpBoard();
    expect(Object.keys(board.values)).toHaveLength(63);
    for (const [id, fam] of Object.entries(board.values)) {
      expect(Number.isFinite(fam.value), id).toBe(true);
      expect(fam.value, id).toBeGreaterThanOrEqual(0);
      expect(fam.value, id).toBeLessThanOrEqual(100);
    }
  });

  it("derives most families at tier 1 or 2, not the coarse category fallback", async () => {
    const board = await jpBoard();
    const strong = Object.values(board.values).filter((f) => f.tier <= 2).length;
    // A collapse to mostly tier 3 means the TIER1 inversion stopped matching
    // the seed's metric ids — derivation would still "work" but be meaningless.
    expect(strong).toBeGreaterThanOrEqual(30);
  });
});

/**
 * Gate on the EMITTED artifact, not just the derivation. `seedPoliticalMetrics`
 * reads nonPlayableBoards.ts directly, so a country dropped from the defense
 * table (or a regeneration run before the table was complete) would ship an
 * incomplete board without the derivation tests noticing — they only sample JP.
 */
describe("emitted non-playable board file", () => {
  it("gives every REGION all 63 families, finite and in 0-100", async () => {
    const { NON_PLAYABLE_BOARDS } = await import("../seeds/nonPlayableBoards");
    const presets = Object.keys(NON_PLAYABLE_BOARDS);
    expect(presets.length).toBeGreaterThanOrEqual(1);
    let regionCount = 0;
    for (const presetId of presets) {
      const countries = Object.keys(NON_PLAYABLE_BOARDS[presetId]);
      expect(countries.length, presetId).toBeGreaterThanOrEqual(22);
      for (const countryId of countries) {
        const byRegion = NON_PLAYABLE_BOARDS[presetId][countryId];
        expect(Object.keys(byRegion).length, countryId).toBeGreaterThan(0);
        for (const [regionId, board] of Object.entries(byRegion)) {
          regionCount++;
          expect(Object.keys(board), `${countryId}/${regionId}`).toHaveLength(63);
          for (const [familyId, v] of Object.entries(board)) {
            const where = `${presetId}/${countryId}/${regionId} ${familyId}`;
            expect(Number.isFinite(v), where).toBe(true);
            expect(v, where).toBeGreaterThanOrEqual(0);
            expect(v, where).toBeLessThanOrEqual(100);
          }
        }
      }
    }
    expect(regionCount).toBeGreaterThanOrEqual(147);
  });

  it("preserves per-region variation instead of copying one national board", async () => {
    // The Phase 0 guarantee. If a regeneration ever collapses back to a single
    // board per country, every non-playable region silently loses its character.
    const { NON_PLAYABLE_BOARDS } = await import("../seeds/nonPlayableBoards");
    const de = NON_PLAYABLE_BOARDS["1953-default"].DE;
    const regionIds = Object.keys(de);
    expect(regionIds.length).toBeGreaterThan(1);
    const board = (r: string) => de[r] as Record<string, number>;
    const varying = Object.keys(board(regionIds[0])).filter(
      (familyId) => new Set(regionIds.map((r) => board(r)[familyId])).size > 1
    );
    expect(varying.length).toBeGreaterThan(10);
  });

  it("keeps the defense block identical across a country's regions", async () => {
    // Defense posture is a national property — the tier-4 table is authored per
    // country, so regional divergence here would mean the derivation leaked.
    const { NON_PLAYABLE_BOARDS } = await import("../seeds/nonPlayableBoards");
    for (const [presetId, byCountry] of Object.entries(NON_PLAYABLE_BOARDS)) {
      for (const [countryId, byRegion] of Object.entries(byCountry)) {
        const regionIds = Object.keys(byRegion);
        for (const familyId of DEFENSE_FAMILIES) {
          const distinct = new Set(
            regionIds.map((r) => (byRegion[r] as Record<string, number>)[familyId])
          );
          const where = `${presetId}/${countryId} ${familyId}`;
          expect(distinct.size, where).toBe(1);
          expect([...distinct][0], where).toBeTypeOf("number");
        }
      }
    }
  });

  it("excludes playable countries, which seed from anchors instead", async () => {
    const { NON_PLAYABLE_BOARDS } = await import("../seeds/nonPlayableBoards");
    for (const byCountry of Object.values(NON_PLAYABLE_BOARDS)) {
      for (const playable of ["US", "UK", "RU", "DD"]) {
        expect(byCountry[playable], playable).toBeUndefined();
      }
    }
  });
});
