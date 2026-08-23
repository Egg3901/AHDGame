import { describe, it, expect } from "vitest";
import {
  CORP_BRAND_PALETTE,
  brandShades,
  normalizeBrandHex,
  randomBrandColor,
  resolveCorpColor,
} from "./brandColor";

function parseHsl(css: string): { h: number; s: number; l: number } {
  const m = /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(css);
  if (!m) throw new Error(`not an hsl() string: ${css}`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

/** Circular hue distance, so 350 and 10 read as 20 apart rather than 340. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("normalizeBrandHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeBrandHex("#0F8")).toBe("#00ff88");
    expect(normalizeBrandHex("#3B82F6")).toBe("#3b82f6");
  });

  it("rejects anything that is not a brand hex", () => {
    for (const bad of ["red", "", "  ", "#12345", "rgb(1,2,3)", null, undefined]) {
      expect(normalizeBrandHex(bad)).toBeNull();
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(normalizeBrandHex("  #3b82f6 ")).toBe("#3b82f6");
  });
});

describe("resolveCorpColor", () => {
  it("prefers a valid brand hex", () => {
    expect(resolveCorpColor("#abcdef", "someid")).toBe("#abcdef");
  });

  it("falls back to a stable colour derived from the id", () => {
    const a = resolveCorpColor(undefined, "68b0f1c2a4e5d60011223344");
    const b = resolveCorpColor(null, "68b0f1c2a4e5d60011223344");
    expect(a).toBe(b);
    expect(CORP_BRAND_PALETTE).toContain(a as (typeof CORP_BRAND_PALETTE)[number]);
  });

  it("falls back rather than passing a junk brand value through", () => {
    const out = resolveCorpColor("not-a-colour", "68b0f1c2a4e5d60011223344");
    expect(CORP_BRAND_PALETTE).toContain(out as (typeof CORP_BRAND_PALETTE)[number]);
  });
});

describe("randomBrandColor", () => {
  it("always returns a palette entry", () => {
    for (let i = 0; i < 50; i++) {
      expect(CORP_BRAND_PALETTE).toContain(
        randomBrandColor() as (typeof CORP_BRAND_PALETTE)[number]
      );
    }
  });
});

describe("brandShades", () => {
  it("returns nothing for a non-positive count", () => {
    expect(brandShades("#3b82f6", 0)).toEqual([]);
    expect(brandShades("#3b82f6", -3)).toEqual([]);
  });

  it("returns exactly `count` distinct shades", () => {
    for (const base of ["#3b82f6", "#10b981", "#ef4444", "#111111", "#f5f5f5"]) {
      for (const n of [1, 2, 3, 5, 8, 11, 20]) {
        const out = brandShades(base, n);
        expect(out).toHaveLength(n);
        expect(new Set(out).size).toBe(n);
      }
    }
  });

  it("keeps the brand's own hue at index 0", () => {
    // #3b82f6 is hue ~217. The first slice is the biggest holder, and it should
    // wear the corp's actual colour rather than a tint of it.
    expect(parseHsl(brandShades("#3b82f6", 6)[0]).h).toBe(217);
    expect(parseHsl(brandShades("#10b981", 6)[0]).h).toBe(160);
  });

  it("stays inside the legible lightness band", () => {
    for (const base of ["#000000", "#ffffff", "#3b82f6"]) {
      for (const shade of brandShades(base, 15)) {
        const { l } = parseHsl(shade);
        expect(l).toBeGreaterThanOrEqual(20);
        expect(l).toBeLessThanOrEqual(82);
      }
    }
  });

  it("separates NEIGHBOURING slices hard, which is where a reader compares them", () => {
    // The ramp alternates between its two ends rather than walking in order, so
    // consecutive slices should never be near-identical even at high counts.
    for (const base of ["#3b82f6", "#10b981", "#111111"]) {
      for (const n of [2, 5, 8, 11]) {
        const out = brandShades(base, n).map(parseHsl);
        for (let i = 1; i < out.length; i++) {
          const gap = Math.abs(out[i].l - out[i - 1].l);
          expect(
            gap,
            `${base} n=${n}: slices ${i - 1} and ${i} are only ${gap} lightness apart`
          ).toBeGreaterThanOrEqual(10);
        }
      }
    }
  });

  it("keeps every pair of shades apart on at least one axis", () => {
    const out = brandShades("#3b82f6", 11).map(parseHsl);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const separated =
          Math.abs(out[i].l - out[j].l) >= 4 ||
          hueGap(out[i].h, out[j].h) >= 4 ||
          Math.abs(out[i].s - out[j].s) >= 4;
        expect(separated, `shades ${i} and ${j} are too close`).toBe(true);
      }
    }
  });

  it("keeps a grey brand grey instead of inventing a hue", () => {
    // Saturation clamping used to push an achromatic brand up to the colour
    // floor, which painted a black-branded corp's cap table red.
    for (const shade of brandShades("#111111", 9)) {
      expect(parseHsl(shade).s).toBeLessThanOrEqual(12);
    }
  });

  it("stays inside the brand's hue family", () => {
    const shades = brandShades("#3b82f6", 11).map(parseHsl);
    for (const shade of shades) {
      expect(hueGap(shade.h, 217)).toBeLessThanOrEqual(30);
    }
  });

  it("falls back to a palette hue when the brand colour is unusable", () => {
    expect(brandShades("nonsense", 4)).toEqual(brandShades(CORP_BRAND_PALETTE[0], 4));
    expect(brandShades(null, 4)).toEqual(brandShades(CORP_BRAND_PALETTE[0], 4));
  });
});
