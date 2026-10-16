import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  loadPlayerIncomeTaxSummary,
  loadUnpaidIncomeTaxByCharacter,
} from "./playerIncomeTaxSummary";
describe("player tax liability valuation", () => {
  it.each([0, -1, NaN, Infinity])(
    "uses the same frozen FX fallback in statements and wealth for %s",
    async (currentRate) => {
      const memory = createInMemoryDb(),
        characterId = new ObjectId(),
        db = memory as unknown as Db;
      memory.seed("playerIncomeTaxAssessments", [
        {
          _id: "synthetic-tax",
          characterId,
          ownerCollection: "characters",
          turn: 1,
          status: "unpaid",
          currency: "USD",
          sourceFx: 2,
          gross: 500,
          federal: 80,
          regional: 20,
          net: 400,
        },
      ]);
      const statement = await loadPlayerIncomeTaxSummary(
        db,
        { _id: characterId },
        1,
        "characters",
        { USD: currentRate }
      );
      const wealth = await loadUnpaidIncomeTaxByCharacter(db, { USD: currentRate });
      expect(statement.unpaidTaxAnchor).toBe(50);
      expect(wealth.get(characterId.toHexString())).toBe(50);
    }
  );
});
