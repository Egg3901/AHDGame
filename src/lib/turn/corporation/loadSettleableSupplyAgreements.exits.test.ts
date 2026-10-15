import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadSettleableSupplyAgreements } from "./loadSettleableSupplyAgreements";

describe("standing supply agreements after counterparty exits", () => {
  it.each(["supplier", "buyer"])(
    "retires a deal when its %s has exited and no longer exists",
    async (side) => {
      const memory = createInMemoryDb();
      const supplier = new ObjectId();
      const buyer = new ObjectId();
      const id = new ObjectId();
      const departed = side === "supplier" ? supplier : buyer;
      memory.seed("corporations", [{ _id: side === "supplier" ? buyer : supplier }]);
      memory.seed("corporationExits", [{ _id: departed, corporationId: departed, turn: 10 }]);
      memory.seed("supplyAgreements", [
        {
          _id: id,
          supplierCorpId: supplier,
          buyerCorpId: buyer,
          commodity: "rare_earth",
          volumeCap: 100,
          pricePremium: 0.05,
          status: "active",
        },
      ]);
      const db = memory as unknown as Db;
      const loaded = await loadSettleableSupplyAgreements({ db, turn: 12, now: new Date() });
      expect(loaded.agreements).toEqual([]);
      expect(await memory.collection("supplyAgreements").findOne({ _id: id })).toMatchObject({
        status: "cancelled",
      });
      expect(
        (await loadSettleableSupplyAgreements({ db, turn: 13, now: new Date() })).agreements
      ).toEqual([]);
    }
  );
  it.each(["healthy", "restored", "unexplained absence"])(
    "preserves a %s open-ended contract on successive turns",
    async (mode) => {
      const memory = createInMemoryDb();
      const supplier = new ObjectId();
      const buyer = new ObjectId();
      const id = new ObjectId();
      memory.seed(
        "corporations",
        mode === "unexplained absence" ? [{ _id: buyer }] : [{ _id: supplier }, { _id: buyer }]
      );
      if (mode === "restored")
        memory.seed("corporationExits", [{ _id: supplier, corporationId: supplier, turn: 10 }]);
      memory.seed("supplyAgreements", [
        {
          _id: id,
          supplierCorpId: supplier,
          buyerCorpId: buyer,
          commodity: "rare_earth",
          volumeCap: 100,
          pricePremium: 0.05,
          status: "active",
        },
      ]);
      for (const turn of [12, 13]) {
        const loaded = await loadSettleableSupplyAgreements({
          db: memory as unknown as Db,
          turn,
          now: new Date(),
        });
        expect(loaded.agreements).toHaveLength(1);
        expect(loaded.agreements[0]?.agreementId).toBe(id.toHexString());
      }
    }
  );
});
