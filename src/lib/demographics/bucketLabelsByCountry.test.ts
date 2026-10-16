import { describe, it, expect } from "vitest";
import { COUNTRY_BUCKET_LABELS, GLOSSED_COUNTRIES } from "./bucketLabelsByCountry";
import { bucketLabel, dimensionLabelFor } from "./bucketLabels";
import { getTurnoutTargetsForCountry } from "./turnoutTargets";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { eraForPreset } from "@/lib/seeds/presetSelector";

const ALL_MODELLED_COUNTRIES = Object.keys(COUNTRY_CONFIGS);

const ERAS = [
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
] as const;

/**
 * Countries with a Layer-1 model — NOT `Object.keys(COUNTRY_BUCKET_LABELS)`.
 *
 * That was the bug this file used to have: iterating the label table meant a
 * country absent from it was absent from the check too, so eight Eastern-bloc
 * countries had models, no labels, and a green test. The gate has to be driven
 * by what the ENGINE can produce, not by what someone remembered to label.
 */
const COUNTRIES = ALL_MODELLED_COUNTRIES.filter((cc) => everyBucket(cc).length > 0);

/** Every bucket a country's model can produce, across every era it is seeded for. */
function everyBucket(cc: string): Array<{ dim: string; key: string }> {
  const out = new Map<string, { dim: string; key: string }>();
  for (const preset of ERAS) {
    let model;
    try {
      model = getCountryLayer1Model(cc, eraForPreset(preset));
    } catch {
      continue;
    }
    if (!model) continue;
    for (const dim of model.dims) {
      for (const key of Object.keys(model.turnoutRates[dim] ?? {})) {
        out.set(`${dim}:${key}`, { dim, key });
      }
    }
  }
  return [...out.values()];
}

describe("native bucket labels", () => {
  // The load-bearing test. A bucket with no authored label falls back to a
  // humanised key ("Degree Plus"), which is exactly the unpolished copy this
  // table exists to remove — and a new era or seed can introduce one silently.
  it.each(COUNTRIES)("%s labels every bucket its model can produce", (cc) => {
    const buckets = everyBucket(cc);
    expect(buckets.length, `${cc} produced no buckets`).toBeGreaterThan(0);
    const missing = buckets
      .filter(({ dim, key }) => !COUNTRY_BUCKET_LABELS[cc]?.buckets[dim]?.[key])
      .map(({ dim, key }) => `${dim}:${key}`);
    expect(missing, `${cc} has unlabelled buckets`).toEqual([]);
  });

  it.each(COUNTRIES)("%s labels every dimension its model uses", (cc) => {
    const dims = new Set(everyBucket(cc).map((b) => b.dim));
    const missing = [...dims].filter((d) => !COUNTRY_BUCKET_LABELS[cc]?.dims[d]);
    expect(missing, `${cc} has unlabelled dimensions`).toEqual([]);
  });

  it.each(COUNTRIES)("%s never renders a raw key", (cc) => {
    for (const section of getTurnoutTargetsForCountry(cc, "1953-default")) {
      expect(section.dimLabel.trim()).not.toBe("");
      for (const o of section.options) {
        expect(o.label.trim(), `${cc} ${o.id}`).not.toBe("");
        expect(o.label, `${cc} ${o.id}`).not.toContain("_");
        expect(o.label, `${cc} ${o.id}`).not.toContain(":");
      }
    }
  });

  // A picker with two identical rows is unusable — a player cannot tell which
  // group they are aiming at.
  it.each(COUNTRIES)("%s labels are unique within a dimension", (cc) => {
    for (const [dim, buckets] of Object.entries(COUNTRY_BUCKET_LABELS[cc]?.buckets ?? {})) {
      const labels = Object.values(buckets);
      expect(new Set(labels).size, `${cc} ${dim} has duplicate labels`).toBe(labels.length);
    }
  });

  it("glosses exactly the non-Latin-script countries", () => {
    for (const cc of COUNTRIES) {
      const labels = Object.values(COUNTRY_BUCKET_LABELS[cc]?.buckets ?? {}).flatMap((b) =>
        Object.values(b)
      );
      const nonLatin = /[^\p{ASCII}\p{Script=Latin}\s\p{P}\p{N}]/u;
      const hasNonLatin = labels.some((l) => nonLatin.test(l));
      expect(hasNonLatin, `${cc} script`).toBe(GLOSSED_COUNTRIES.has(cc));
      if (GLOSSED_COUNTRIES.has(cc)) {
        // Every glossed label must actually carry its English reading, or the
        // picker is unreadable for a player who cannot read the script.
        for (const l of labels) expect(l, `${cc} "${l}" has no gloss`).toMatch(/\(.+\)$/);
      }
    }
  });

  it("resolves through bucketLabel with the country, and falls back without it", () => {
    expect(bucketLabel("education:hochschulabschluss", "DE")).toBe("Hochschulabschluss");
    expect(bucketLabel("education:university", "JP")).toBe("大学卒 (University)");
    expect(dimensionLabelFor("income", "SE")).toBe("Income");
    // No country → the US vocabulary, unchanged.
    expect(bucketLabel("race:black")).toBe("Black voters");
    expect(dimensionLabelFor("education")).toBe("Education");
    // Unknown country → humanised, never blank.
    expect(bucketLabel("education:university", "ZZ")).toBe("University");
  });

  it("keeps the US on its own labels", () => {
    expect(COUNTRY_BUCKET_LABELS.US).toBeUndefined();
    const dims = getTurnoutTargetsForCountry("US", "2019-default");
    expect(dims.map((d) => d.dimLabel)).toEqual(["Background", "Age", "Education", "Income"]);
  });
});
