import { describe, it, expect } from "vitest";
import {
  isSeedFoundingSector,
  planSectorRedenomination,
  summarizeImpact,
  CREATED_AT_TOLERANCE_MS,
} from "./fixSeedSectorCurrencyDenomination";

const T0 = new Date("2026-08-01T00:00:00.000Z");

const corp = {
  ceoType: "npp",
  type: "manufacturing",
  headquartersState: "KAN",
  createdAt: T0,
};

const sector = {
  stateId: "KAN",
  sectorType: "manufacturing",
  createdAt: T0,
  revenue: 1_200_000,
};

describe("isSeedFoundingSector", () => {
  it("matches the row spawnNppCorporation inserts", () => {
    expect(isSeedFoundingSector(sector, corp)).toBe(true);
  });

  it("tolerates the sub-second gap between the two inserts", () => {
    const later = { ...sector, createdAt: new Date(T0.getTime() + 900) };
    expect(isSeedFoundingSector(later, corp)).toBe(true);
  });

  it("rejects a sector created long after the corp (later expansion / takeover)", () => {
    const later = {
      ...sector,
      createdAt: new Date(T0.getTime() + CREATED_AT_TOLERANCE_MS + 1),
    };
    expect(isSeedFoundingSector(later, corp)).toBe(false);
  });

  it("rejects a sector in a different state", () => {
    expect(isSeedFoundingSector({ ...sector, stateId: "KIN" }, corp)).toBe(false);
  });

  it("rejects a sector of a different type", () => {
    expect(isSeedFoundingSector({ ...sector, sectorType: "energy" }, corp)).toBe(false);
  });

  it("rejects a player-owned corp", () => {
    expect(isSeedFoundingSector(sector, { ...corp, ceoType: "character" })).toBe(false);
  });

  it("rejects when either timestamp is missing", () => {
    expect(isSeedFoundingSector({ ...sector, createdAt: null }, corp)).toBe(false);
    expect(isSeedFoundingSector(sector, { ...corp, createdAt: null })).toBe(false);
  });

  it("accepts ISO-string timestamps", () => {
    expect(isSeedFoundingSector({ ...sector, createdAt: T0.toISOString() }, corp)).toBe(true);
  });
});

describe("planSectorRedenomination", () => {
  const jp = { sector, corp, hostCurrencyCode: "JPY", hostFxRate: 360 };

  it("multiplies the stored value by the host FX rate", () => {
    const plan = planSectorRedenomination(jp);
    expect(plan).toMatchObject({
      action: "rescale",
      storedBefore: 1_200_000,
      storedAfter: 432_000_000,
    });
  });

  it("restores the ₳ figure readers should have been seeing all along", () => {
    const plan = planSectorRedenomination(jp);
    if (plan.action !== "rescale") throw new Error("expected rescale");
    // Before: the ₳ figure divided by fx a SECOND time — 1/360 of its weight.
    expect(plan.anchorBefore).toBeCloseTo(1_200_000 / 360, 6);
    // After: the ₳ figure itself.
    expect(plan.anchorAfter).toBeCloseTo(1_200_000, 6);
    expect(plan.anchorAfter / plan.anchorBefore).toBeCloseTo(360, 6);
  });

  it("skips a non-seed sector", () => {
    expect(planSectorRedenomination({ ...jp, sector: { ...sector, stateId: "KIN" } })).toEqual({
      action: "skip",
      reason: "not-seed-founding",
    });
  });

  it("skips a row the plants turn processor has already restated", () => {
    expect(planSectorRedenomination({ ...jp, sector: { ...sector, plantsStartTurn: 12 } })).toEqual(
      { action: "skip", reason: "already-plants-restated" }
    );
  });

  it("skips an anchor-rate sector (fx == 1) — the arithmetic is a no-op", () => {
    expect(planSectorRedenomination({ ...jp, hostCurrencyCode: "USD", hostFxRate: 1 })).toEqual({
      action: "skip",
      reason: "anchor-currency-noop",
    });
  });

  it("skips a missing or non-positive FX rate rather than guessing", () => {
    expect(planSectorRedenomination({ ...jp, hostFxRate: 0 })).toEqual({
      action: "skip",
      reason: "anchor-currency-noop",
    });
    expect(planSectorRedenomination({ ...jp, hostCurrencyCode: null })).toEqual({
      action: "skip",
      reason: "no-host-currency",
    });
  });

  it("skips a zero-revenue sector", () => {
    expect(planSectorRedenomination({ ...jp, sector: { ...sector, revenue: 0 } })).toEqual({
      action: "skip",
      reason: "non-positive-revenue",
    });
  });

  it("is NOT arithmetically idempotent — the marker is the only guard", () => {
    const first = planSectorRedenomination(jp);
    if (first.action !== "rescale") throw new Error("expected rescale");
    const second = planSectorRedenomination({
      ...jp,
      sector: { ...sector, revenue: first.storedAfter },
    });
    if (second.action !== "rescale") throw new Error("expected rescale");
    expect(second.storedAfter).toBe(first.storedAfter * 360);
  });
});

describe("summarizeImpact", () => {
  it("computes world shares before and after", () => {
    const out = summarizeImpact([
      { countryId: "JP", sectorsRescaled: 51, anchorBefore: 1, anchorAfter: 360 },
      { countryId: "US", sectorsRescaled: 0, anchorBefore: 360, anchorAfter: 360 },
    ]);
    const jp = out.find((r) => r.countryId === "JP")!;
    const us = out.find((r) => r.countryId === "US")!;
    expect(jp.shareBefore).toBeCloseTo(100 / 361, 6);
    expect(jp.shareAfter).toBeCloseTo(50, 6);
    expect(us.shareAfter).toBeCloseTo(50, 6);
    expect(jp.factor).toBeCloseTo(360, 6);
    expect(us.factor).toBeCloseTo(1, 6);
  });

  it("sorts by post-fix share and survives an empty world", () => {
    expect(summarizeImpact([])).toEqual([]);
    const out = summarizeImpact([
      { countryId: "A", sectorsRescaled: 0, anchorBefore: 1, anchorAfter: 1 },
      { countryId: "B", sectorsRescaled: 0, anchorBefore: 5, anchorAfter: 5 },
    ]);
    expect(out.map((r) => r.countryId)).toEqual(["B", "A"]);
  });
});
