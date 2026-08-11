import { describe, expect, it } from "vitest";
import { ALIGNMENT_ERAS, type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";
import { axisFor, leadFor, statusFor } from "./project";

const COLD = ALIGNMENT_ERAS.find((e) => e.key === "cold-war")!;
const MODERN = ALIGNMENT_ERAS.find((e) => e.key === "post-cold-war")!;
const TWO: AlignmentPoleId[] = ["WEST", "EAST"];
const THREE: AlignmentPoleId[] = ["WASHINGTON", "MOSCOW", "BEIJING"];

const cold = (west: number, east: number) => normalizeShares({ WEST: west, EAST: east }, TWO);

describe("axisFor", () => {
  // These are the source design's published values — the authored 1953 seed
  // must reproduce them exactly.
  it.each([
    ["East Germany", 2, 88, -86],
    ["Yugoslavia", 22, 50, -28],
    ["Finland", 18, 40, -22],
    ["Sweden", 30, 18, 12],
    ["Italy", 55, 10, 45],
    ["Turkey", 60, 8, 52],
    ["United States", 96, 1, 95],
  ])("reproduces %s at %i/%i as %i", (_name, west, east, expected) => {
    expect(axisFor(cold(west as number, east as number), COLD)).toBe(expected);
  });

  it("takes its sign from axisPositivePoleId, not from pole order", () => {
    // WEST is the positive pole, so a West-leaning nation is POSITIVE. If this
    // were derived from `poles` array order the sign would invert.
    expect(axisFor(cold(60, 8), COLD)).toBeGreaterThan(0);
    expect(axisFor(cold(8, 60), COLD)).toBeLessThan(0);
  });

  it("returns null when the era has no single axis", () => {
    const shares = normalizeShares({ WASHINGTON: 40, MOSCOW: 16, BEIJING: 8 }, THREE);
    expect(axisFor(shares, MODERN)).toBeNull();
  });
});

describe("leadFor", () => {
  it("is the gap between the top two poles", () => {
    expect(leadFor(cold(30, 18))).toBe(12);
    expect(leadFor(cold(22, 50))).toBe(28);
  });

  it("counts the second pole as zero when only one has any share", () => {
    expect(leadFor(normalizeShares({ WEST: 40 }, TWO))).toBe(40);
  });

  it("is zero for a perfectly split nation", () => {
    expect(leadFor(cold(25, 25))).toBe(0);
  });
});

describe("statusFor", () => {
  const at = (west: number, east: number, extra: Partial<Parameters<typeof statusFor>[0]> = {}) =>
    statusFor({
      shares: cold(west, east),
      poleCount: 2,
      isPlayer: false,
      isMember: false,
      ...extra,
    });

  it("puts Player above everything", () => {
    expect(at(96, 1, { isPlayer: true }).status).toBe("player");
  });

  it("locks an immovable nation", () => {
    expect(at(2, 88).status).toBe("locked");
  });

  it("reads a member above the gate as loyal and below it as a defection risk", () => {
    expect(at(60, 8, { isMember: true }).status).toBe("loyal");
    // Italy: +45 axis, lead 45, below the two-pole gate of 50.
    expect(at(55, 10, { isMember: true }).status).toBe("defection-risk");
  });

  it("reads a non-member above the gate as eligible", () => {
    expect(at(60, 8).status).toBe("eligible");
  });

  it("reads Sweden as non-aligned — the case that fails if the ladder uses the top share", () => {
    // Top share 30 is ABOVE the non-aligned gate of 20; the lead of 12 is not.
    const r = at(30, 18);
    expect(leadFor(cold(30, 18))).toBe(12);
    expect(r.status).toBe("non-aligned");
  });

  it("reads Yugoslavia as contested", () => {
    expect(at(22, 50).status).toBe("contested");
  });

  it("applies the pole-count gate, not a fixed one", () => {
    const shares = normalizeShares({ WASHINGTON: 50, MOSCOW: 5, BEIJING: 2 }, THREE);
    // lead 45 sits in the gap between the gates: past the three-pole 40, short
    // of the two-pole 50.
    expect(statusFor({ shares, poleCount: 3, isPlayer: false, isMember: false }).status).toBe(
      "eligible"
    );
    expect(statusFor({ shares, poleCount: 2, isPlayer: false, isMember: false }).status).toBe(
      "contested"
    );
  });

  it("never returns a Leaning band", () => {
    const bands = new Set<string>();
    for (let w = 0; w <= 100; w += 2) bands.add(at(w, 100 - w).status);
    expect(bands.has("leaning")).toBe(false);
  });

  it("reports the leading pole alongside the status", () => {
    expect(at(60, 8).topPoleId).toBe("WEST");
    expect(at(8, 60).topPoleId).toBe("EAST");
  });
});
