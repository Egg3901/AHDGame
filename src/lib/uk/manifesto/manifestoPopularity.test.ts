import { describe, it, expect } from "vitest";
import {
  manifestoMultiplierForGroup,
  pledgePopularityForGroup,
  pledgeSalienceForGroup,
  isPledgeKept,
  evaluateDelivery,
  DEFAULT_MANIFESTO_MAX_SWING,
} from "./manifestoPopularity";
import type { PledgeCatalogEntry } from "@/lib/db/types/manifesto";

function entry(over: Partial<PledgeCatalogEntry>): PledgeCatalogEntry {
  return {
    id: "t",
    label: "t",
    policyDomain: "health",
    targets: [{ legislationTypeId: "nhs", policyOptionId: "increase" }],
    position: { economic: 0, social: 0 },
    targetSemantics: "enact",
    baseSalience: 1,
    countryId: "UK" as PledgeCatalogEntry["countryId"],
    ...over,
  };
}

describe("salience", () => {
  it("uses per-group value over base, clamped", () => {
    const e = entry({ baseSalience: 0.2, salienceByGroup: { "age:senior": 1.5, "age:young": -1 } });
    expect(pledgeSalienceForGroup(e, "age:senior")).toBe(1); // clamped to 1
    expect(pledgeSalienceForGroup(e, "age:young")).toBe(0); // clamped to 0
    expect(pledgeSalienceForGroup(e, "unknown")).toBe(0.2); // base fallback
  });
});

describe("pledge popularity sign", () => {
  const left = entry({ position: { economic: -4, social: -2 } });
  it("is positive for an aligned group, negative for an opposed one", () => {
    const aligned = pledgePopularityForGroup(left, { economicLean: -4, socialLean: -2 }, "g");
    const opposed = pledgePopularityForGroup(left, { economicLean: 4, socialLean: 2 }, "g");
    expect(aligned).toBeGreaterThan(0);
    expect(opposed).toBeLessThan(0);
    expect(aligned).toBeGreaterThan(opposed);
  });
  it("scales with salience", () => {
    const hi = entry({ position: { economic: -4, social: 0 }, baseSalience: 1 });
    const lo = entry({ position: { economic: -4, social: 0 }, baseSalience: 0.5 });
    const g = { economicLean: -4, socialLean: 0 };
    expect(pledgePopularityForGroup(hi, g, "x")).toBeCloseTo(
      2 * pledgePopularityForGroup(lo, g, "x"),
      5
    );
  });
});

describe("manifesto multiplier", () => {
  it("is 1.0 with no pledges", () => {
    expect(manifestoMultiplierForGroup([], { economicLean: 0, socialLean: 0 }, "g")).toBe(1);
  });
  it("stays within ±maxSwing", () => {
    const pledges = [
      entry({ position: { economic: -5, social: -5 } }),
      entry({ position: { economic: -5, social: -5 } }),
    ];
    const best = manifestoMultiplierForGroup(pledges, { economicLean: -5, socialLean: -5 }, "g");
    const worst = manifestoMultiplierForGroup(pledges, { economicLean: 5, socialLean: 5 }, "g");
    expect(best).toBeLessThanOrEqual(1 + DEFAULT_MANIFESTO_MAX_SWING + 1e-9);
    expect(worst).toBeGreaterThanOrEqual(1 - DEFAULT_MANIFESTO_MAX_SWING - 1e-9);
    expect(best).toBeGreaterThan(worst);
  });
  it("respects a custom maxSwing", () => {
    const pledges = [entry({ position: { economic: -5, social: -5 } })];
    const m = manifestoMultiplierForGroup(
      pledges,
      { economicLean: -5, socialLean: -5 },
      "g",
      { maxSwing: 0.1 }
    );
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThanOrEqual(1.1 + 1e-9);
  });
});

describe("kept/broken: enact", () => {
  const targets = [{ legislationTypeId: "nhs", policyOptionId: "increase" }];
  it("kept when the mapped option is active", () => {
    expect(isPledgeKept(targets, "enact", { nhs: { policyOptionId: "increase" } }).kept).toBe(true);
  });
  it("broken when a different option is active", () => {
    expect(isPledgeKept(targets, "enact", { nhs: { policyOptionId: "cut" } }).kept).toBe(false);
  });
  it("broken when untouched", () => {
    expect(isPledgeKept(targets, "enact", {}).kept).toBe(false);
  });
});

describe("kept/broken: maintain", () => {
  const targets = [{ legislationTypeId: "nhs", policyOptionId: "current" }];
  const dirs = { nhs: 1 }; // pledge wants the positive direction preserved
  it("kept when untouched", () => {
    expect(isPledgeKept(targets, "maintain", {}, dirs).kept).toBe(true);
  });
  it("kept when still at baseline", () => {
    expect(
      isPledgeKept(targets, "maintain", { nhs: { policyOptionId: "current", effectDirection: 0 } }, dirs)
        .kept
    ).toBe(true);
  });
  it("broken when moved to the opposite direction (a cut)", () => {
    expect(
      isPledgeKept(targets, "maintain", { nhs: { policyOptionId: "cut", effectDirection: -1 } }, dirs)
        .kept
    ).toBe(false);
  });
  it("kept when moved further in the pledged direction", () => {
    expect(
      isPledgeKept(
        targets,
        "maintain",
        { nhs: { policyOptionId: "boost", effectDirection: 1 } },
        dirs
      ).kept
    ).toBe(true);
  });
});

describe("evaluateDelivery", () => {
  it("counts kept/broken and computes the meter", () => {
    const r = evaluateDelivery(
      [
        {
          catalogEntryId: "a",
          targets: [{ legislationTypeId: "nhs", policyOptionId: "increase" }],
          targetSemantics: "enact",
        },
        {
          catalogEntryId: "b",
          targets: [{ legislationTypeId: "tax", policyOptionId: "cut" }],
          targetSemantics: "enact",
        },
      ],
      { nhs: { policyOptionId: "increase" } }
    );
    expect(r.total).toBe(2);
    expect(r.kept).toBe(1);
    expect(r.broken).toBe(1);
    expect(r.meter).toBe(0.5);
  });
});
