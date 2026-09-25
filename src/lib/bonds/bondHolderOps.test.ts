import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { reserveBondUnitsForHolder } from "./bondHolderOps";

describe("reserveBondUnitsForHolder", () => {
  it("keeps the bond snapshot guard on each reservation attempt", async () => {
    const updateOne = vi
      .fn()
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    const db = { collection: () => ({ updateOne }) } as unknown as Db;
    const bondId = new ObjectId();
    const nppId = new ObjectId();

    const reserved = await reserveBondUnitsForHolder(
      db,
      bondId,
      { field: "nppId", id: nppId },
      10,
      new Date("2026-01-01T00:00:00Z"),
      { guardFilter: { marketPrice: 0.95, maturityTurn: 1129, defaulted: false } }
    );

    expect(reserved).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(3);
    for (const [filter] of updateOne.mock.calls) {
      expect(filter).toMatchObject({
        _id: bondId,
        publicFloat: { $gte: 10 },
        marketPrice: 0.95,
        maturityTurn: 1129,
        defaulted: false,
      });
    }
  });
});
