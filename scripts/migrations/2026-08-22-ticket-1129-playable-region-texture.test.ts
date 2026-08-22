import { describe, it, expect } from "vitest";
import { planTextureBackfill } from "./2026-08-22-ticket-1129-playable-region-texture";
import { REGIONAL_TEXTURE_1953 } from "@/lib/politicalMetrics/seeds/regionalTexture1953";
import { FAMILY_SLUGS, POLITICAL_METRIC_CATEGORIES } from "@/lib/politicalMetrics/types";

const VALID_FAMILIES = new Set(
  POLITICAL_METRIC_CATEGORIES.flatMap((c) =>
    (FAMILY_SLUGS[c.id as keyof typeof FAMILY_SLUGS] as readonly string[]).map(
      (f) => `${c.id}.${f}`
    )
  )
);

/** A US region that actually carries texture, so the tests are not vacuous. */
const TEXTURED_US = Object.entries(
  REGIONAL_TEXTURE_1953.US as Record<string, Record<string, number>>
).find(([, families]) => families["order.safety"] !== undefined)!;
const REGION_ID = TEXTURED_US[0];
const DEVIATION = TEXTURED_US[1]["order.safety"];

describe("planTextureBackfill", () => {
  it("adds the region's texture to its existing residuals", () => {
    const ops = planTextureBackfill([
      { _id: REGION_ID, countryId: "US", residuals: { "order.safety": 51.5 } },
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0].residuals["order.safety"]).toBeCloseTo(51.5 + DEVIATION, 6);
  });

  /**
   * THE invariant of this file. `residuals` is keyed by literal dotted family
   * ids, so a `$set` of "residuals.order.safety" is read by Mongo as a nested
   * path -- it creates `residuals: { order: { safety: v } }`, never touches the
   * real key, loses the write, and raises no error. That has shipped three times
   * in this codebase. The plan therefore returns the WHOLE map to $set.
   */
  it("returns a whole residuals map keyed by bare family ids", () => {
    const ops = planTextureBackfill([
      { _id: REGION_ID, countryId: "US", residuals: { "order.safety": 51.5 } },
    ]);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      for (const [key, value] of Object.entries(op.residuals)) {
        // A real family id, not a path prefixed with the field name. Asserted
        // positively so this file never has to spell the bad prefix out.
        expect(VALID_FAMILIES.has(key)).toBe(true);
        // Flat: one level, numbers only. A nested object here would be the bug.
        expect(typeof value).toBe("number");
      }
    }
  });

  it("preserves families the texture does not touch", () => {
    const ops = planTextureBackfill([
      {
        _id: REGION_ID,
        countryId: "US",
        residuals: { "order.safety": 51.5, "economy.fiscal": 20, "defense.armedForces": 74 },
      },
    ]);
    // defense.armedForces has no texture anywhere, so it must survive verbatim.
    expect(ops[0].residuals["defense.armedForces"]).toBe(74);
  });

  it("never emits a doc without residuals, which would trip the self-heal", () => {
    // politicalMetricsDynamics' lazy self-heal fires when `residuals` is absent
    // and adopts the doc's CURRENT values as permanent equilibrium. Creating the
    // field here, or unsetting it, would bake the flatness in irreversibly.
    expect(planTextureBackfill([{ _id: REGION_ID, countryId: "US" }])).toEqual([]);
  });

  it("is idempotent - a doc already stamped is skipped", () => {
    const ops = planTextureBackfill([
      {
        _id: REGION_ID,
        countryId: "US",
        residuals: { "order.safety": 51.5 },
        textureBackfillTurn: 318,
      },
    ]);
    expect(ops).toEqual([]);
  });

  it("ignores non-playable countries", () => {
    const ops = planTextureBackfill([
      { _id: "JP_KANTO", countryId: "JP", residuals: { "order.safety": 40 } },
    ]);
    expect(ops).toEqual([]);
  });

  it("skips a family the live doc has no residual for rather than inventing one", () => {
    const ops = planTextureBackfill([
      { _id: REGION_ID, countryId: "US", residuals: { "economy.fiscal": 20 } },
    ]);
    for (const op of ops) {
      expect(op.residuals["order.safety"]).toBeUndefined();
    }
  });
});
