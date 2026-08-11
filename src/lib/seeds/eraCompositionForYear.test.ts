import { describe, expect, it } from "vitest";
import { ERA_COMPOSITIONS } from "./demographicCategories";
import { ERA_ANCHOR_YEARS, ERA_IDS_ASC } from "./eraInterpolation";
import { canonicalizeComposition, getEraCompositionForYear } from "./eraCompositionForYear";

/**
 * Normalised weight of a bucket within a group's recipe — the quantity the
 * seeders actually consume, and therefore the thing canonicalisation must
 * preserve exactly.
 */
function normalizedWeight(
  weights: Array<{ dim: string; key: string; w: number }>,
  dim: string,
  key: string
): number {
  const total = weights.reduce((s, w) => s + w.w, 0);
  if (total === 0) return 0;
  const found = weights.find((w) => w.dim === dim && w.key === key);
  return found ? found.w / total : 0;
}

describe("canonicalisation is value-preserving", () => {
  it("keeps every authored bucket's normalised weight identical", () => {
    for (const era of ERA_IDS_ASC) {
      const authored = ERA_COMPOSITIONS[era];
      if (!authored) continue;
      const canonical = canonicalizeComposition(authored);
      for (const [groupId, entry] of Object.entries(authored.voterGroupComposition)) {
        const canonEntry = canonical.voterGroupComposition[groupId];
        expect(canonEntry, `${era}/${groupId}`).toBeDefined();
        for (const w of entry.weights) {
          expect(
            normalizedWeight(canonEntry.weights, w.dim, w.key),
            `${era}/${groupId}/${w.dim}:${w.key}`
          ).toBeCloseTo(normalizedWeight(entry.weights, w.dim, w.key), 12);
        }
      }
    }
  });

  it("pads absent buckets at exactly zero", () => {
    for (const era of ERA_IDS_ASC) {
      const authored = ERA_COMPOSITIONS[era];
      if (!authored) continue;
      const canonical = canonicalizeComposition(authored);
      for (const [groupId, entry] of Object.entries(authored.voterGroupComposition)) {
        const authoredKeys = new Set(entry.weights.map((w) => `${w.dim}:${w.key}`));
        for (const w of canonical.voterGroupComposition[groupId].weights) {
          if (!authoredKeys.has(`${w.dim}:${w.key}`)) {
            expect(w.w, `${era}/${groupId}/${w.dim}:${w.key}`).toBe(0);
          }
        }
      }
    }
  });

  it("gives every era the same recipe shape per group — the whole point", () => {
    const shapes = new Map<string, string>();
    for (const era of ERA_IDS_ASC) {
      const authored = ERA_COMPOSITIONS[era];
      if (!authored) continue;
      const canonical = canonicalizeComposition(authored);
      for (const [groupId, entry] of Object.entries(canonical.voterGroupComposition)) {
        const shape = entry.weights.map((w) => `${w.dim}:${w.key}`).join("|");
        const seen = shapes.get(groupId);
        if (seen === undefined) shapes.set(groupId, shape);
        else expect(shape, `${groupId} @ ${era}`).toBe(seen);
      }
    }
    expect(shapes.size).toBeGreaterThan(0);
  });
});

describe("getEraCompositionForYear", () => {
  it("returns the canonicalised anchor at every anchor year", () => {
    for (const era of ERA_IDS_ASC) {
      if (!ERA_COMPOSITIONS[era]) continue;
      expect(getEraCompositionForYear(ERA_ANCHOR_YEARS[era])).toEqual(
        canonicalizeComposition(ERA_COMPOSITIONS[era])
      );
    }
  });

  it("interpolates across the three gaps a raw lerp used to throw on", () => {
    // college_liberals 1953->1979, evangelicals 1991->1999, union_trades 2019->2023.
    for (const year of [1966, 1995, 2021]) {
      expect(() => getEraCompositionForYear(year)).not.toThrow();
    }
  });

  it("fades a newly-added bucket in from zero rather than stepping", () => {
    // Find a group whose recipe genuinely gains a bucket across an anchor gap.
    const lo = canonicalizeComposition(ERA_COMPOSITIONS["1953"]);
    const hi = canonicalizeComposition(ERA_COMPOSITIONS["1979"]);
    let checked = 0;
    for (const [groupId, loEntry] of Object.entries(lo.voterGroupComposition)) {
      const hiEntry = hi.voterGroupComposition[groupId];
      if (!hiEntry) continue;
      for (let i = 0; i < loEntry.weights.length; i++) {
        const a = loEntry.weights[i];
        const b = hiEntry.weights[i];
        if (a.w !== 0 || b.w === 0) continue;
        // Zero at 1953, positive at 1979 — must be strictly between at 1966.
        const mid = getEraCompositionForYear(1966).voterGroupComposition[groupId].weights[i];
        expect(mid.w, `${groupId}/${a.dim}:${a.key}`).toBeGreaterThan(0);
        expect(mid.w, `${groupId}/${a.dim}:${a.key}`).toBeLessThan(b.w);
        checked++;
      }
    }
    expect(checked, "expected at least one bucket to enter a recipe mid-series").toBeGreaterThan(0);
  });

  it("clamps outside the anchor range", () => {
    expect(getEraCompositionForYear(1900)).toEqual(getEraCompositionForYear(1953));
    expect(getEraCompositionForYear(2100)).toEqual(getEraCompositionForYear(2023));
  });
});
