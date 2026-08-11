import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  applyExecutivePoliticalImpact,
  computeExecutivePoliticalImpact,
} from "../executivePoliticalImpact";

describe("computeExecutivePoliticalImpact", () => {
  it("repudiate has the largest hit", () => {
    const r = computeExecutivePoliticalImpact("repudiate");
    expect(r.favorabilityDelta).toBe(-20);
    expect(r.infamyDelta).toBe(15);
  });

  it("monetize is second-worst", () => {
    const r = computeExecutivePoliticalImpact("monetize");
    expect(r.favorabilityDelta).toBe(-15);
    expect(r.infamyDelta).toBe(10);
  });

  it("bailout is moderately punishing (austerity backlash)", () => {
    const r = computeExecutivePoliticalImpact("bailout");
    expect(r.favorabilityDelta).toBe(-10);
    expect(r.infamyDelta).toBe(5);
  });

  it("restructure is the least-bad path", () => {
    const r = computeExecutivePoliticalImpact("restructure");
    expect(r.favorabilityDelta).toBe(-8);
    expect(r.infamyDelta).toBe(5);
  });

  it("repudiate hits favorability harder than restructure", () => {
    const rep = computeExecutivePoliticalImpact("repudiate");
    const res = computeExecutivePoliticalImpact("restructure");
    expect(Math.abs(rep.favorabilityDelta)).toBeGreaterThan(Math.abs(res.favorabilityDelta));
  });
});

describe("applyExecutivePoliticalImpact", () => {
  it("no-op when characterId is null", async () => {
    const updateOne = vi.fn();
    const db = { collection: vi.fn(() => ({ updateOne })) } as never;
    const r = await applyExecutivePoliticalImpact(db, null, "repudiate");
    expect(r.applied).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("no-op when characterId is undefined", async () => {
    const updateOne = vi.fn();
    const db = { collection: vi.fn(() => ({ updateOne })) } as never;
    const r = await applyExecutivePoliticalImpact(db, undefined, "repudiate");
    expect(r.applied).toBe(false);
  });

  it("applies $inc with the path's deltas when characterId is present", async () => {
    const charId = new ObjectId();
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = { collection: vi.fn(() => ({ updateOne })) } as never;
    const r = await applyExecutivePoliticalImpact(db, charId, "monetize");
    expect(r.applied).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][1]).toEqual({
      $inc: { favorability: -15, infamy: 10 },
    });
  });
});
