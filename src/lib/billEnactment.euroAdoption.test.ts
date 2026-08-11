import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { applyEuroAdoptionProvision } from "@/lib/billEnactment";

function makeDb(euroAdoptedCountries: string[] | undefined) {
  const findOne = vi.fn().mockResolvedValue({ euroAdoptedCountries });
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  return {
    collection: vi.fn().mockReturnValue({ findOne, updateOne }),
    _findOne: findOne,
    _updateOne: updateOne,
  };
}

describe("applyEuroAdoptionProvision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores non-EU-member countries (US)", async () => {
    const db = makeDb([]);
    await applyEuroAdoptionProvision(db as unknown as Db, "US");
    expect(db._updateOne).not.toHaveBeenCalled();
  });

  it("ignores non-EU-member countries (UK)", async () => {
    const db = makeDb([]);
    await applyEuroAdoptionProvision(db as unknown as Db, "UK");
    expect(db._updateOne).not.toHaveBeenCalled();
  });

  it("adds DE to euroAdoptedCountries via $addToSet", async () => {
    const db = makeDb(["DE"]);
    await applyEuroAdoptionProvision(db as unknown as Db, "DE");
    expect(db._updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      { $addToSet: { euroAdoptedCountries: "DE" } }
    );
  });

  it("does NOT set eurozoneEnabled when only DE has adopted (IE still pending)", async () => {
    const db = makeDb(["DE"]);
    await applyEuroAdoptionProvision(db as unknown as Db, "DE");
    const setCall = db._updateOne.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).$set
    );
    expect(setCall).toBeUndefined();
  });

  it("sets eurozoneEnabled = true when both DE and IE have adopted", async () => {
    const db = makeDb(["DE", "IE"]);
    await applyEuroAdoptionProvision(db as unknown as Db, "IE");
    const setCall = db._updateOne.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).$set
    );
    expect(setCall).toBeTruthy();
    expect((setCall![1] as Record<string, unknown>).$set).toMatchObject({
      eurozoneEnabled: true,
    });
  });

  it("handles undefined euroAdoptedCountries gracefully (treats as [])", async () => {
    const findOne = vi.fn().mockResolvedValue({ euroAdoptedCountries: undefined });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const db = { collection: vi.fn().mockReturnValue({ findOne, updateOne }) };
    await applyEuroAdoptionProvision(db as unknown as Db, "DE");
    // Only DE adopted → should NOT set eurozoneEnabled
    const setCall = updateOne.mock.calls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).$set
    );
    expect(setCall).toBeUndefined();
  });
});
