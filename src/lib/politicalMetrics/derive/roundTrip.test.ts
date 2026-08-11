/**
 * Tier-1 acceptance test (spec §5).
 *
 * ADAPTER_TIER1 is used FORWARD in production (political board → corp margin
 * base modifiers). This plan uses it BACKWARD (legacy seed → political board).
 * Round-tripping a real country's seed must produce margin modifiers in the
 * same direction as the board implies — a polarity error would silently
 * reprice every non-playable sector when stateMetrics is deleted at step 6.
 */
import { describe, expect, it } from "vitest";
import { deriveCountryBoard } from "./deriveFamilies";
import { buildPoliticalBaseModifiers } from "@/lib/politicalLegislation/marginAdapter";
import type { PoliticalMetricId } from "../types";

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

async function jpFlat(): Promise<Record<string, number>> {
  const { jpStateMetrics } = await import("@/lib/seeds/jp/jpStateMetrics");
  return flatten(jpStateMetrics[0] as unknown as Record<string, unknown>);
}

const asValues = (board: ReturnType<typeof deriveCountryBoard>) =>
  Object.fromEntries(Object.entries(board.values).map(([k, f]) => [k, f.value])) as Record<
    PoliticalMetricId,
    number
  >;

describe("tier-1 round trip", () => {
  it("derived board produces finite margin modifiers", async () => {
    const legacy = await jpFlat();
    const board = deriveCountryBoard({ countryId: "JP", legacy, macro: legacy });
    // Returns a Map<string, { modifier, rawValue }> — not a plain object.
    const modifiers = buildPoliticalBaseModifiers(asValues(board));
    expect(modifiers.size).toBeGreaterThan(0);
    for (const [signal, v] of modifiers) {
      expect(Number.isFinite(v.modifier), signal).toBe(true);
      expect(Number.isFinite(v.rawValue), signal).toBe(true);
    }
  });

  it("a strong seed round-trips to better margins than a weak one", async () => {
    // Direction is the property that matters: if inversion flipped a polarity,
    // a high-quality country would round-trip to WORSE modifiers than a poor one.
    const legacy = await jpFlat();
    const strong = deriveCountryBoard({ countryId: "JP", legacy, macro: legacy });

    // A uniformly worst-case seed: every metric pinned at the low end of its
    // range. Polarity is per-metric, so this is not "all bad" for every metric —
    // but averaged across ~56 families the strong board must still come out ahead.
    const weakLegacy = Object.fromEntries(Object.keys(legacy).map((k) => [k, 0]));
    const weak = deriveCountryBoard({ countryId: "JP", legacy: weakLegacy, macro: weakLegacy });

    const meanBoard = (b: ReturnType<typeof deriveCountryBoard>) => {
      const vs = Object.values(b.values).map((f) => f.value);
      return vs.reduce((a, x) => a + x, 0) / vs.length;
    };
    expect(meanBoard(strong)).toBeGreaterThan(meanBoard(weak));

    const sum = (b: ReturnType<typeof deriveCountryBoard>) =>
      [...buildPoliticalBaseModifiers(asValues(b)).values()].reduce((a, v) => a + v.modifier, 0);
    expect(sum(strong)).toBeGreaterThan(sum(weak));
  });
});
