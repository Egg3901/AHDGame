import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { purchasedHoldingTerms, mergeHoldingTerms } from "@/lib/corporations/rules/holdingTerms";
import { holdingMaturationWrites } from "./holdingMaturationWrites";
import type { Corporation } from "@/lib/db/types";
describe("holding maturation persistence", () => {
  it("follows owner identity when a concurrent trade changes shareholder array order", async () => {
    const memory = createInMemoryDb(),
      id = new ObjectId(),
      a = new ObjectId(),
      b = new ObjectId();
    const original = {
      _id: id,
      shareholders: [
        { characterId: a, shares: 10, holdingTerms: purchasedHoldingTerms(10, 3, 0) },
        { characterId: b, shares: 5, holdingTerms: purchasedHoldingTerms(5, 7, 20) },
      ],
    };
    const ops = holdingMaturationWrites(original as unknown as Corporation, 48);
    memory.seed("corporations", [
      { ...original, shareholders: [original.shareholders[1], original.shareholders[0]] },
    ]);
    await memory.collection("corporations").bulkWrite(ops as never);
    const rows = (await memory.collection("corporations").findOne({ _id: id }))!
      .shareholders as typeof original.shareholders;
    expect(rows[0].holdingTerms).toEqual(purchasedHoldingTerms(5, 7, 20));
    expect(rows[1].holdingTerms).toEqual({
      longTermShares: 10,
      longTermCostBasisAnchor: 30,
      shortTermLots: [],
    });
  });
  it("does not overwrite a newer purchase when maturation loses its snapshot guard", async () => {
    const memory = createInMemoryDb(),
      id = new ObjectId(),
      a = new ObjectId();
    const prior = purchasedHoldingTerms(10, 3, 0),
      next = mergeHoldingTerms(prior, purchasedHoldingTerms(5, 7, 48), 48);
    const original = {
      _id: id,
      shareholders: [{ characterId: a, shares: 10, holdingTerms: prior }],
    };
    const ops = holdingMaturationWrites(original as unknown as Corporation, 48);
    memory.seed("corporations", [
      { _id: id, shareholders: [{ characterId: a, shares: 15, holdingTerms: next }] },
    ]);
    const result = await memory.collection("corporations").bulkWrite(ops as never);
    expect(result.matchedCount).toBe(0);
    expect((await memory.collection("corporations").findOne({ _id: id }))!.shareholders).toEqual([
      { characterId: a, shares: 15, holdingTerms: next },
    ]);
  });
});
