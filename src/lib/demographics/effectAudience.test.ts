import { describe, it, expect } from "vitest";
import { describeApprovalEffects, bucketsDescribeCountry } from "./effectAudience";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";

const name = (id: string) => id.replace(/_/g, " ");

describe("describing approval effects", () => {
  it("names Layer-1 buckets in the US, not archetypes", () => {
    const rows = describeApprovalEffects({ college_liberals: 6 }, "US", name);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.label)).not.toContain("college liberals");
    for (const r of rows) {
      expect(r.label).not.toContain("_");
      expect(r.label).not.toContain(":");
    }
  });

  it("sorts by magnitude so the biggest movers read first", () => {
    const rows = describeApprovalEffects({ college_liberals: 6, retirees: -2 }, "US", name);
    const mags = rows.map((r) => Math.abs(r.value));
    expect(mags).toEqual([...mags].sort((a, b) => b - a));
  });

  it("drops zero and non-finite effects", () => {
    const rows = describeApprovalEffects(
      { college_liberals: 0, retirees: NaN as number } as Record<string, number>,
      "US",
      name
    );
    expect(rows).toEqual([]);
  });

  // Now describes buckets abroad too, in that country's own language.
  it("names UK buckets for a UK bill", () => {
    expect(bucketsDescribeCountry("UK")).toBe(true);
    const rows = describeApprovalEffects({ post_industrial_workers: 5 }, "UK", name);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((r) => r.label)).toContain("No qualifications");
    expect(rows.reduce((s, r) => s + r.value, 0)).toBeCloseTo(5, 6);
  });

  it("uses the country's own language", () => {
    const de = describeApprovalEffects({ gewerkschafter: 5 }, "DE", name);
    expect(de.some((r) => /[ÄÖÜäöüß]|Einkommen|Abschluss|Großstadt/.test(r.label))).toBe(true);
    const jp = describeApprovalEffects({ salaryman_conservative: 5 }, "JP", name);
    // Native script with the English gloss the labels carry.
    expect(jp.every((r) => /\(.+\)$/.test(r.label))).toBe(true);
  });

  // A world with no Layer-1 model has no buckets to name.
  it("keeps archetype names where a country has no bucket model", () => {
    expect(bucketsDescribeCountry("ZZ")).toBe(false);
    expect(describeApprovalEffects({ some_group: 5 }, "ZZ", name)).toEqual([
      { id: "some_group", label: "some group", value: 5 },
    ]);
  });

  it("the US vocabulary really is foreign to a non-US model", () => {
    const model = getCountryLayer1Model("UK", eraForPreset("1953-default"))!;
    const real = new Set(
      model.dims.flatMap((d) => Object.keys(model.turnoutRates[d] ?? {}).map((k) => `${d}:${k}`))
    );
    const projected = describeApprovalEffects({ college_liberals: 6 }, "US", name).map((r) => r.id);
    expect(projected.length).toBeGreaterThan(0);
    // Pins why the two vocabularies must never be mixed: US buckets are not UK
    // buckets, which is what made the old shared table lose 70-80% of an effect.
    expect(projected.some((id) => !real.has(id))).toBe(true);
  });
});
