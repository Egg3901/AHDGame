import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { GoverningAgendaItem } from "../governingAgenda";
import {
  computeGovernmentPerformance,
  applyGovernmentPerformanceNudge,
} from "../governmentPerformance";

const item = (domain: string, target: number, priority = 1): GoverningAgendaItem => ({
  domain,
  target,
  direction: "raise",
  priority,
});

describe("computeGovernmentPerformance (pure)", () => {
  it("rewards a government that meets its targets", () => {
    const r = computeGovernmentPerformance([item("healthcare", 60)], { healthcare: 60 });
    expect(r.score).toBeCloseTo(1);
    expect(r.favorabilityDelta).toBeGreaterThan(0);
  });

  it("punishes a government that misses its targets", () => {
    const r = computeGovernmentPerformance([item("healthcare", 60)], { healthcare: 0 });
    expect(r.score).toBeCloseTo(0);
    expect(r.favorabilityDelta).toBeLessThan(0);
    expect(r.favorabilityDelta).toBeGreaterThanOrEqual(-4); // clamped
  });

  it("is priority-weighted across goals", () => {
    // A heavily-weighted met goal + a lightly-weighted missed one → above par.
    const r = computeGovernmentPerformance(
      [item("healthcare", 60, 0.9), item("education", 60, 0.1)],
      { healthcare: 60, education: 0 }
    );
    expect(r.score).toBeCloseTo(0.9);
    expect(r.favorabilityDelta).toBeGreaterThan(0);
  });

  it("is par with no nudge when no goal has measurable health", () => {
    const r = computeGovernmentPerformance([item("healthcare", 60)], {});
    expect(r.favorabilityDelta).toBe(0);
  });

  it("rewards a government that met a 'lower' (cut) goal", () => {
    const lowerItem = { ...item("healthcare", 45), direction: "lower" as const };
    const r = computeGovernmentPerformance([lowerItem], { healthcare: 40 }); // at/below floor
    expect(r.score).toBeCloseTo(1);
    expect(r.favorabilityDelta).toBeGreaterThan(0);
  });

  it("punishes a government that failed to cut toward a 'lower' goal", () => {
    const lowerItem = { ...item("healthcare", 45), direction: "lower" as const };
    const r = computeGovernmentPerformance([lowerItem], { healthcare: 90 }); // barely cut at all
    expect(r.score).toBeLessThan(0.6);
    expect(r.favorabilityDelta).toBeLessThan(0);
  });
});

describe("applyGovernmentPerformanceNudge (I/O)", () => {
  it("nudges the governing party's NPP favorability, clamped", async () => {
    const db = createMockDb();
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 3 });
    db.collectionMocks["npps"] = {
      ...db.collection("npps"),
      updateMany,
    } as (typeof db.collectionMocks)[string];

    const n = await applyGovernmentPerformanceNudge(db as unknown as Db, "IE", "5", -2, new Date());
    expect(n).toBe(3);
    const filter = updateMany.mock.calls[0][0];
    expect(filter).toMatchObject({ countryId: "IE", party: "5", retiredAt: null });
  });

  it("no-ops on a zero delta", async () => {
    const db = createMockDb();
    const updateMany = vi.fn();
    db.collectionMocks["npps"] = {
      ...db.collection("npps"),
      updateMany,
    } as (typeof db.collectionMocks)[string];

    const n = await applyGovernmentPerformanceNudge(db as unknown as Db, "IE", "5", 0, new Date());
    expect(n).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
