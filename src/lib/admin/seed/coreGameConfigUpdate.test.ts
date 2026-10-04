import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { coreGameConfigUpdate } from "./coreGameConfigUpdate";

describe("1991 player banking seed settings", () => {
  it("enables fresh/reset 1991 access while preserving existing disabled gates on top-up", async () => {
    const db = createInMemoryDb();
    const config = db.collection("gameConfig");
    await config.updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });
    expect(config.docs[0]).toMatchObject({
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
      playerAdvancedBankChartersEnabled: true,
      bankPropForexFeesEnabled: true,
    });
    await config.updateOne(
      { _id: "default" },
      { $set: { playerAdvancedBankChartersEnabled: false, bankPropForexFeesEnabled: false } }
    );
    await config.updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });
    expect(config.docs[0]).toMatchObject({
      playerAdvancedBankChartersEnabled: false,
      bankPropForexFeesEnabled: false,
    });
    await config.updateOne({ _id: "default" }, coreGameConfigUpdate(true, 1991), { upsert: true });
    expect(config.docs[0]).toMatchObject({
      playerAdvancedBankChartersEnabled: true,
      bankPropForexFeesEnabled: true,
    });
  });
  it("leaves absent banking gates absent when topping up an existing legacy world", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [{ _id: "default" }]);
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });
    for (const key of [
      "privateBankingEnabled",
      "bankPropTradingEnabled",
      "playerAdvancedBankChartersEnabled",
      "bankPropForexFeesEnabled",
    ])
      expect(db.collection("gameConfig").docs[0]).not.toHaveProperty(key);
  });
});
