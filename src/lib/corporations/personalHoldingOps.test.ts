import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { updatePersonalHolding, type PersonalHoldingChange } from "./personalHoldingOps";
import { holdingCostBasis, holdingShares, purchasedHoldingTerms } from "./rules/holdingTerms";
import type { ShareHoldingTerms } from "./rules/holdingTerms";
function testCorporation(value: unknown) {
  return value as {
    publicFloat: number;
    shareholders: Array<{
      characterId: ObjectId;
      shares: number;
      holdingTerms: ShareHoldingTerms;
      avgCostPerShare: number;
    }>;
  };
}

describe("personal holding persistence", () => {
  function fixture() {
    const memory = createInMemoryDb();
    memory.seed("gameState", [{ _id: "current", stockHoldingTaxStartTurn: 0 }]);
    const corporationId = new ObjectId();
    const ownerId = new ObjectId();
    memory.seed("corporations", [
      {
        _id: corporationId,
        publicFloat: 100,
        shareholders: [
          {
            characterId: ownerId,
            shares: 10,
            avgCostPerShare: 3,
            holdingTerms: { longTermShares: 10, longTermCostBasisAnchor: 30, shortTermLots: [] },
          },
        ],
      },
    ]);
    const input = {
      db: memory as unknown as Db,
      corporationId,
      ownerId,
      ownerKey: "characterId" as const,
    };
    return { memory, input };
  }
  it("replays an older purchase after a newer lot without changing either acquisition date", async () => {
    const { memory, input } = fixture();
    await updatePersonalHolding({
      ...input,
      shares: 2,
      credit: true,
      pricePerShare: 7,
      change: { turn: 20 },
    });
    await updatePersonalHolding({
      ...input,
      shares: 3,
      credit: true,
      pricePerShare: 5,
      change: { turn: 10 },
      key: "recovered-purchase",
    });
    await updatePersonalHolding({
      ...input,
      shares: 3,
      credit: true,
      pricePerShare: 5,
      change: { turn: 10 },
      key: "recovered-purchase",
    });
    const holder = testCorporation(await memory.collection("corporations").findOne({}))
      .shareholders[0];
    expect(holder.shares).toBe(15);
    expect(holder.holdingTerms.shortTermLots).toEqual([
      { acquiredTurn: 10, shares: 3, costBasisAnchor: 15 },
      { acquiredTurn: 20, shares: 2, costBasisAnchor: 14 },
    ]);
  });
  it("preserves both concurrent purchases and unrelated shareholder entries", async () => {
    const { memory, input } = fixture();
    const other = new ObjectId();
    await memory
      .collection("corporations")
      .updateOne(
        { _id: input.corporationId },
        { $push: { shareholders: { characterId: other, shares: 77 } } }
      );
    const results = await Promise.all([
      updatePersonalHolding({
        ...input,
        shares: 5,
        credit: true,
        pricePerShare: 4,
        change: { turn: 10 },
        extra: { $inc: { publicFloat: -5 } },
        guardFilter: { publicFloat: { $gte: 5 } },
      }),
      updatePersonalHolding({
        ...input,
        shares: 5,
        credit: true,
        pricePerShare: 6,
        change: { turn: 10 },
        extra: { $inc: { publicFloat: -5 } },
        guardFilter: { publicFloat: { $gte: 5 } },
      }),
    ]);
    expect(results).not.toContain(null);
    const corp = testCorporation(await memory.collection("corporations").findOne({}));
    const holder = corp!.shareholders.find((row: { characterId: ObjectId }) =>
      row.characterId.equals(input.ownerId)
    );
    expect(holdingShares(holder!.holdingTerms)).toBe(20);
    expect(holdingCostBasis(holder!.holdingTerms)).toBe(80);
    expect(corp!.publicFloat).toBe(90);
    expect(
      corp!.shareholders.find((row: { characterId: ObjectId }) => row.characterId.equals(other))!
        .shares
    ).toBe(77);
  });
  it("prevents two sales from consuming the same inventory", async () => {
    const { memory, input } = fixture();
    const changes: PersonalHoldingChange[] = [
      { turn: 10, term: "long" },
      { turn: 10, term: "long" },
    ];
    const results = await Promise.all(
      changes.map((change) => updatePersonalHolding({ ...input, shares: 7, credit: false, change }))
    );
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(changes.filter((change) => change.taken)).toHaveLength(1);
    const corp = testCorporation(await memory.collection("corporations").findOne({}));
    expect(corp!.shareholders[0].shares).toBe(3);
    expect(corp!.shareholders[0].holdingTerms.longTermCostBasisAnchor).toBe(9);
  });
  it("restores an escrow at its original age and cost", async () => {
    const { memory, input } = fixture();
    await updatePersonalHolding({
      ...input,
      shares: 5,
      credit: true,
      pricePerShare: 4,
      change: { turn: 10 },
    });
    const change: PersonalHoldingChange = { turn: 11, term: "short" };
    await updatePersonalHolding({ ...input, shares: 5, credit: false, change });
    await updatePersonalHolding({
      ...input,
      shares: 5,
      credit: true,
      change: { turn: 58, restore: change.taken },
    });
    const holder = testCorporation(await memory.collection("corporations").findOne({}))
      .shareholders[0];
    expect(holder.holdingTerms).toEqual({
      longTermShares: 15,
      longTermCostBasisAnchor: 50,
      shortTermLots: [],
    });
  });
  it("compensates an exact purchase without removing an older short-term lot", async () => {
    const { memory, input } = fixture();
    await updatePersonalHolding({
      ...input,
      shares: 5,
      credit: true,
      pricePerShare: 4,
      change: { turn: 10 },
    });
    await updatePersonalHolding({
      ...input,
      shares: 5,
      credit: true,
      pricePerShare: 6,
      change: { turn: 11 },
    });
    await updatePersonalHolding({
      ...input,
      shares: 5,
      credit: false,
      change: { turn: 11, remove: purchasedHoldingTerms(5, 6, 11) },
    });
    const holder = testCorporation(await memory.collection("corporations").findOne({}))
      .shareholders[0];
    expect(holder.holdingTerms.shortTermLots).toEqual([
      { acquiredTurn: 10, shares: 5, costBasisAnchor: 20 },
    ]);
    expect(holder.avgCostPerShare).toBeCloseTo(50 / 15);
  });
  it("returns no receipt when a corporation-level guard fails", async () => {
    const { memory, input } = fixture();
    const change: PersonalHoldingChange = { turn: 11, term: "long" };
    expect(
      await updatePersonalHolding({
        ...input,
        shares: 5,
        credit: false,
        change,
        guardFilter: { publicFloat: { $gte: 1000 } },
      })
    ).toBeNull();
    expect(change.taken).toBeUndefined();
    expect(
      testCorporation(await memory.collection("corporations").findOne({})).shareholders[0].shares
    ).toBe(10);
  });
  it("does not remove a fresh credit while cleaning up a zero-share entry", async () => {
    const { memory, input } = fixture();
    const collection = memory.collection("corporations");
    const update = collection.updateOne.bind(collection);
    let interleaved = false;
    vi.spyOn(collection, "updateOne").mockImplementation(async (filter, change) => {
      if (!Array.isArray(change) && change.$pull && !interleaved) {
        interleaved = true;
        await updatePersonalHolding({
          ...input,
          shares: 1,
          credit: true,
          pricePerShare: 8,
          change: { turn: 11 },
        });
      }
      return update(filter, change);
    });
    await updatePersonalHolding({
      ...input,
      shares: 10,
      credit: false,
      change: { turn: 11, term: "long" },
    });
    expect(testCorporation(await collection.findOne({})).shareholders[0].shares).toBe(1);
  });
});
