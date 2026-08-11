/**
 * Player-facing bucket names. Archetype labels are being removed from the
 * interface entirely, so every surface that named a voter archetype needs a
 * name for a Layer-1 bucket instead — and none of them may render blank.
 */
import { describe, expect, it } from "vitest";
import { ARCHETYPE_BUCKET_MAP } from "./archetypeBucketMap";
import { BUCKET_LABELS, allBucketIds, bucketLabel, bucketOptionsByDimension } from "./bucketLabels";
import { GRANULAR_DIMENSIONS } from "./granularCells";

describe("bucket labels", () => {
  it("labels every bucket any mapping can produce", () => {
    // If a mapping targets a bucket with no label, a targeting UI built on
    // these would show a blank row.
    const used = new Set<string>();
    for (const weights of Object.values(ARCHETYPE_BUCKET_MAP)) {
      for (const { dim, key } of weights) used.add(`${dim}:${key}`);
    }
    const labelled = new Set(allBucketIds());
    const missing = [...used].filter((b) => !labelled.has(b));
    expect(missing, "these buckets would render unlabelled").toEqual([]);
  });

  it("covers every dimension", () => {
    for (const dim of GRANULAR_DIMENSIONS) {
      expect(Object.keys(BUCKET_LABELS[dim]).length, `${dim} has no buckets`).toBeGreaterThan(0);
    }
  });

  it("never returns an empty or model-jargon label", () => {
    for (const id of allBucketIds()) {
      const label = bucketLabel(id);
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toMatch(/bucket|layer.?1|dim:/i);
      // A raw key must never leak through as the visible name.
      expect(label).not.toBe(id);
    }
  });

  it("falls back readably for an unknown bucket instead of breaking", () => {
    expect(bucketLabel("age:not_a_bucket")).toBe("Not A Bucket");
    expect(bucketLabel("garbage")).toBe("Garbage");
    expect(bucketLabel("").length).toBe(0);
  });

  it("groups options by dimension for a sectioned picker", () => {
    const groups = bucketOptionsByDimension();
    expect(groups).toHaveLength(GRANULAR_DIMENSIONS.length);
    for (const g of groups) {
      expect(g.dimLabel.trim().length).toBeGreaterThan(0);
      expect(g.options.length).toBeGreaterThan(0);
      for (const o of g.options) expect(o.id.startsWith(`${g.dim}:`)).toBe(true);
    }
    // Every labelled bucket appears exactly once across the groups.
    const ids = groups.flatMap((g) => g.options.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(allBucketIds().sort());
  });

  it("has no duplicate labels within a dimension", () => {
    for (const dim of GRANULAR_DIMENSIONS) {
      const labels = Object.values(BUCKET_LABELS[dim]);
      expect(new Set(labels).size, `${dim} has duplicate labels`).toBe(labels.length);
    }
  });
});
