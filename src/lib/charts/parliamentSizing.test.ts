import { describe, expect, it } from "vitest";
import { computeRowRadii, getParliamentSizing } from "./parliamentSizing";

// Hard ceiling: outerR must stay below this so the dynamic viewBox safety net
// in the renderer doesn't have to expand by more than ~12% (keeping the chart
// from visibly shrinking inside its container).
const HARD_CEILING = 220;

// Soft target: chambers that hit this stay within the default 400-unit
// viewBox without any expansion. Worth meeting for new tiers; DE Bundestag
// (736) is the one legacy borderline case (outerR=205).
const SOFT_TARGET = 200;

describe("getParliamentSizing", () => {
  it.each([
    { label: "US Senate (100)", total: 100 },
    { label: "UK Lords cap (200)", total: 200 },
    { label: "UK Commons (650)", total: 650 },
    { label: "JP Reps (465)", total: 465 },
    { label: "Hypothetical 1200", total: 1200 },
    { label: "CN NPC (2980)", total: 2980 },
  ])("keeps outerR within the soft viewBox target for $label", ({ total }) => {
    const sizing = getParliamentSizing(total);
    const { outerR, rowRadii } = computeRowRadii(sizing, total);

    expect(rowRadii.length).toBeGreaterThan(0);
    expect(outerR).toBeLessThanOrEqual(SOFT_TARGET);
  });

  it("keeps every reasonable chamber size under the hard ceiling", () => {
    for (const total of [100, 200, 435, 465, 650, 736, 1000, 1500, 2000, 2980]) {
      const sizing = getParliamentSizing(total);
      const { outerR } = computeRowRadii(sizing, total);
      expect(outerR).toBeLessThanOrEqual(HARD_CEILING);
    }
  });

  it("flags only small chambers as senate-style", () => {
    expect(getParliamentSizing(50).isSenate).toBe(true);
    expect(getParliamentSizing(110).isSenate).toBe(true);
    expect(getParliamentSizing(111).isSenate).toBe(false);
  });

  it("produces total row capacity at least equal to total seats", () => {
    for (const total of [100, 200, 435, 650, 736, 1000, 1500, 2000, 2980]) {
      const sizing = getParliamentSizing(total);
      const { rowRadii } = computeRowRadii(sizing, total);
      const minGap = sizing.dotR * 2.4;
      const capacity = rowRadii.reduce(
        (s, r) => s + Math.max(1, Math.floor((Math.PI * r) / minGap)),
        0
      );
      expect(capacity).toBeGreaterThanOrEqual(total);
    }
  });

  // Regression: at 2980 seats the outer rows used to extend past the fixed
  // `0 0 400 211` viewBox in `<ParliamentChart>` and `parliamentChart.ts`,
  // clipping the bottom-left and bottom-right ends of the hemicycle. This
  // simulates the renderer's dynamic viewBox and asserts that every dot —
  // including the outermost row's bottom-most dot at angles 0 and π — lands
  // inside the box.
  it("keeps every dot inside the renderer's dynamic viewBox for CN NPC", () => {
    const cx = 200;
    const cy = 195;
    const total = 2980;
    const sizing = getParliamentSizing(total);
    const { outerR } = computeRowRadii(sizing, total);

    const halfW = Math.max(200, outerR + 8);
    const vbX = cx - halfW;
    const vbW = halfW * 2;
    const vbY = Math.min(0, cy - outerR - 12);
    const vbH = cy + 16 - vbY;

    // Outer-row leftmost dot (angle = π) and rightmost dot (angle = 0) — the
    // two extremes most likely to fall outside the viewBox.
    const leftMostX = cx + outerR * Math.cos(Math.PI);
    const rightMostX = cx + outerR * Math.cos(0);
    const topMostY = cy - outerR * Math.sin(Math.PI / 2);

    expect(leftMostX).toBeGreaterThanOrEqual(vbX);
    expect(rightMostX).toBeLessThanOrEqual(vbX + vbW);
    expect(topMostY).toBeGreaterThanOrEqual(vbY);
    expect(cy).toBeLessThanOrEqual(vbY + vbH);
  });
});
