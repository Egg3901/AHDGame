import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { ensureDemographicWorldEpoch } from "./worldEpoch";

function fixture(initial?: { worldEpochId?: string }) {
  let current = initial;
  const findOne = vi.fn(async () => current ?? null);
  const findOneAndUpdate = vi.fn(
    async (_filter: { worldEpochId?: unknown }, update: { $set: { worldEpochId: string } }) => {
      if (!current || current.worldEpochId) return null;
      current = { ...current, ...update.$set };
      return current;
    }
  );
  const collection = vi.fn(() => ({ findOne, findOneAndUpdate }));
  return { db: { collection } as unknown as Db, findOne, findOneAndUpdate, collection };
}

describe("population receipt world identity", () => {
  it("uses the locked world's known identity without another lookup", async () => {
    const f = fixture();
    expect(await ensureDemographicWorldEpoch(f.db, { worldEpochId: "known-world" })).toBe(
      "known-world"
    );
    expect(f.collection).not.toHaveBeenCalled();
  });

  it("keeps an existing world identity unchanged", async () => {
    const f = fixture({ worldEpochId: "existing-world" });
    expect(await ensureDemographicWorldEpoch(f.db)).toBe("existing-world");
    expect(f.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("initializes legacy identity once and keeps it on retry", async () => {
    const f = fixture({});
    const first = await ensureDemographicWorldEpoch(f.db);
    const retry = await ensureDemographicWorldEpoch(f.db);
    expect(ObjectId.isValid(first)).toBe(true);
    expect(retry).toBe(first);
    expect(f.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(f.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ worldEpochId: { $exists: false } });
  });

  it("uses the competing initialization winner", async () => {
    const f = fixture({});
    f.findOneAndUpdate.mockResolvedValueOnce(null);
    f.findOne.mockResolvedValueOnce({}).mockResolvedValueOnce({ worldEpochId: "winner-world" });
    expect(await ensureDemographicWorldEpoch(f.db)).toBe("winner-world");
  });

  it("requires a real game state and does not upsert an incomplete world", async () => {
    const f = fixture();
    await expect(ensureDemographicWorldEpoch(f.db)).rejects.toThrow("initialized world");
    expect(f.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
