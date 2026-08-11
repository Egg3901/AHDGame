import { describe, expect, it } from "vitest";
import { polesForYear } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";
import {
  applyAlignmentToMembership,
  primarySphereFor,
  projectSphereAlignment,
  sponsorForPole,
} from "./sphereProjection";

const cold = (w: number, e: number) => normalizeShares({ WEST: w, EAST: e }, polesForYear(1953));

describe("sponsorForPole", () => {
  it("maps each bloc pole to its patron", () => {
    expect(sponsorForPole("WEST")).toBe("US");
    expect(sponsorForPole("EAST")).toBe("RU");
    expect(sponsorForPole("WASHINGTON")).toBe("US");
    expect(sponsorForPole("MOSCOW")).toBe("RU");
    expect(sponsorForPole("BEIJING")).toBe("CN");
  });
});

describe("projectSphereAlignment", () => {
  it("expresses each share as a 0-1 alignment with that pole's sponsor", () => {
    const m = projectSphereAlignment({ shares: cold(60, 8), year: 1953 });
    expect(m.get("US")).toBeCloseTo(0.6, 5);
    expect(m.get("RU")).toBeCloseTo(0.08, 5);
  });

  it("covers every pole of the era, even at zero", () => {
    const m = projectSphereAlignment({ shares: cold(60, 0), year: 1953 });
    expect(m.get("RU")).toBe(0);
  });

  it("names all three patrons in a modern world", () => {
    const shares = normalizeShares({ WASHINGTON: 30, MOSCOW: 20, BEIJING: 25 }, polesForYear(2019));
    const m = projectSphereAlignment({ shares, year: 2019 });
    expect([...m.keys()].sort()).toEqual(["CN", "RU", "US"]);
    expect(m.get("CN")).toBeCloseTo(0.25, 5);
  });
});

describe("primarySphereFor", () => {
  it("names the patron once a nation is committed", () => {
    // lead 52, above the two-pole gate of 50
    expect(primarySphereFor({ shares: cold(60, 8), year: 1953 })).toBe("US");
  });

  it("returns null for a nation nobody has committed", () => {
    // Sweden: lead 12, inside the non-aligned band
    expect(primarySphereFor({ shares: cold(30, 18), year: 1953 })).toBeNull();
  });

  it("returns null for a contested nation below the gate", () => {
    // Yugoslavia: lead 28 — leaning East, but not yet anyone's
    expect(primarySphereFor({ shares: cold(22, 50), year: 1953 })).toBeNull();
  });

  it("uses the era's own gate, so a three-pole world commits at a lower lead", () => {
    // lead 43: above the three-pole gate of 40, below the two-pole gate of 50.
    const modern = normalizeShares({ WASHINGTON: 45, MOSCOW: 2, BEIJING: 2 }, polesForYear(2019));
    expect(primarySphereFor({ shares: modern, year: 2019 })).toBe("US");
  });
});

describe("applyAlignmentToMembership", () => {
  const rel = (sponsorId: string, alignment: number) => ({
    sponsorId,
    alignment,
    integration: 0.5,
    treatyIds: [],
    treatyState: "active" as const,
  });
  const membership = (primary: string | null, ...rels: ReturnType<typeof rel>[]) => ({
    entityId: "AT",
    presetId: "1953-default",
    primarySphereId: primary,
    relationships: rels,
  });

  it("writes each sponsor's pole share onto its relationship", () => {
    const next = applyAlignmentToMembership({
      membership: membership("US", rel("US", 0.1), rel("RU", 0.9)),
      shares: cold(60, 8),
      year: 1953,
    });
    expect(next.relationships.find((r) => r.sponsorId === "US")!.alignment).toBeCloseTo(0.6, 5);
    expect(next.relationships.find((r) => r.sponsorId === "RU")!.alignment).toBeCloseTo(0.08, 5);
  });

  it("never touches integration — that stays sphere-owned", () => {
    const next = applyAlignmentToMembership({
      membership: membership("US", rel("US", 0.1)),
      shares: cold(60, 8),
      year: 1953,
    });
    expect(next.relationships[0]!.integration).toBe(0.5);
  });

  it("migrates the primary when alignment crosses to the other bloc", () => {
    const next = applyAlignmentToMembership({
      membership: membership("US", rel("US", 0.6), rel("RU", 0.1)),
      shares: cold(5, 60), // now firmly East
      year: 1953,
    });
    expect(next.primarySphereId).toBe("RU");
  });

  it("drops the primary when a single-patron nation stops being committed", () => {
    const next = applyAlignmentToMembership({
      membership: membership("US", rel("US", 0.6)),
      shares: cold(30, 18), // lead 12 — nobody's
      year: 1953,
    });
    expect(next.primarySphereId).toBeNull();
  });

  it("keeps a nominal primary when the record cannot legally have none", () => {
    // Two relationships: assertValidSphereMembership forbids a null primary.
    const next = applyAlignmentToMembership({
      membership: membership("US", rel("US", 0.6), rel("RU", 0.1)),
      shares: cold(30, 18),
      year: 1953,
    });
    expect(next.primarySphereId).toBe("US"); // the stronger surviving tie
  });

  it("does not invent a relationship for a patron the nation has none with", () => {
    const next = applyAlignmentToMembership({
      membership: membership("RU", rel("RU", 0.4)),
      shares: cold(60, 8), // committed to the US, but has no US relationship
      year: 1953,
    });
    expect(next.relationships).toHaveLength(1);
    expect(next.primarySphereId).toBe("RU");
  });

  it("leaves a sponsor that is not a pole leader alone", () => {
    const next = applyAlignmentToMembership({
      membership: membership("UK", rel("UK", 0.42)),
      shares: cold(60, 8),
      year: 1953,
    });
    expect(next.relationships[0]!.alignment).toBe(0.42);
  });

  it("produces a membership the sphere validator accepts", async () => {
    const { assertValidSphereMembership } = await import("@/lib/world/spheres/relationships");
    for (const shares of [cold(60, 8), cold(30, 18), cold(5, 60), cold(0, 0)]) {
      const next = applyAlignmentToMembership({
        membership: membership("US", rel("US", 0.6), rel("RU", 0.1)),
        shares,
        year: 1953,
      });
      expect(() => assertValidSphereMembership(next)).not.toThrow();
    }
  });
});
