import { describe, it, expect } from "vitest";
import { BLEND, FONT, OPS_LEVER_COLOR, blendSegments } from "./tokens";

// The Blend palette is transcribed from the Claude Design canvas (Proposal D).
// These assertions pin the exact values so a later refactor cannot silently
// reskin the four screens away from the design that was signed off.
describe("BLEND palette", () => {
  it("pins the surface ramp", () => {
    expect(BLEND.page).toBe("#0c0c12");
    expect(BLEND.rail).toBe("#101018");
    expect(BLEND.inset).toBe("#11111a");
    expect(BLEND.track).toBe("#1a1a25");
    expect(BLEND.trackAlt).toBe("#1d1d2a");
    expect(BLEND.field).toBe("#14141c");
  });

  it("pins the hairlines and ink ramp", () => {
    expect(BLEND.hairline).toBe("#22222f");
    expect(BLEND.hairlineStrong).toBe("#2a2a3d");
    expect(BLEND.chipBorder).toBe("#26263a");
    expect(BLEND.ink).toBe("#e8e8ee");
    expect(BLEND.muted).toBe("#8f8f9d");
    expect(BLEND.mutedDim).toBe("#6b6b7a");
    expect(BLEND.mutedDimmer).toBe("#5f5f70");
  });

  it("pins the semantic accents", () => {
    expect(BLEND.accent).toBe("#dc2626");
    expect(BLEND.accentInk).toBe("#f0a0a0");
    expect(BLEND.positive).toBe("#22c55e");
    expect(BLEND.caution).toBe("#eab308");
    expect(BLEND.gold).toBe("#d4af37");
    expect(BLEND.negative).toBe("#ef4444");
  });
});

describe("FONT stacks", () => {
  it("routes through the next/font CSS variables already registered in layout", () => {
    expect(FONT.serif).toContain("var(--font-lora)");
    expect(FONT.mono).toContain("var(--font-jetbrains-mono)");
    expect(FONT.sans).toContain("var(--font-geist-sans)");
  });

  it("keeps a real fallback face on every stack", () => {
    expect(FONT.serif).toContain("Georgia");
    expect(FONT.mono).toContain("monospace");
    expect(FONT.sans).toContain("sans-serif");
  });
});

describe("OPS_LEVER_COLOR", () => {
  it("gives each campaign lever its Proposal D colour", () => {
    expect(OPS_LEVER_COLOR.fundraising).toBe("#fbbf24");
    expect(OPS_LEVER_COLOR.oppositionResearch).toBe("#f87171");
    expect(OPS_LEVER_COLOR.groundGame).toBe("#60a5fa");
    expect(OPS_LEVER_COLOR.mediaSpending).toBe("#c084fc");
  });
});

describe("blendSegments", () => {
  it("fills the invested segments and leaves the rest on the track colour", () => {
    const segs = blendSegments(3, 10, "#60a5fa");
    expect(segs).toHaveLength(10);
    for (let i = 0; i < 3; i++) expect(segs[i]).toContain("#60a5fa");
    for (let i = 3; i < 10; i++) expect(segs[i]).toContain(BLEND.hairlineStrong);
  });

  it("handles the fully empty and fully filled ends", () => {
    expect(blendSegments(0, 3, "#fbbf24").every((s) => s.includes(BLEND.hairlineStrong))).toBe(
      true
    );
    expect(blendSegments(3, 3, "#fbbf24").every((s) => s.includes("#fbbf24"))).toBe(true);
  });

  it("clamps an over-filled count rather than emitting extra segments", () => {
    const segs = blendSegments(99, 4, "#fbbf24");
    expect(segs).toHaveLength(4);
    expect(segs.every((s) => s.includes("#fbbf24"))).toBe(true);
  });

  it("never emits a negative or fractional segment count", () => {
    expect(blendSegments(-2, 5, "#fbbf24")).toHaveLength(5);
    expect(blendSegments(-2, 5, "#fbbf24").every((s) => s.includes(BLEND.hairlineStrong))).toBe(
      true
    );
  });
});
