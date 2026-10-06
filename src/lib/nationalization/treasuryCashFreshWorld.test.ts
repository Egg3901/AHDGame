import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { coreGameConfigUpdate } from "@/lib/admin/seed/coreGameConfigUpdate";
import { resolveBankingPolicy } from "@/lib/banking/rules/policy";
import { loadTreasuryCashContext } from "./treasuryLedger";

describe("funded Treasury cash on a fresh world", () => {
  it("is on for a reset world and reaches the cash writers' context", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: false }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 1, preset: "1991-default" }]);
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, coreGameConfigUpdate(true, 1991), { upsert: true });

    const config = db.collection("gameConfig").docs[0];
    expect(config.treasuryCashLedgerEnabled).toBe(true);
    const context = await loadTreasuryCashContext(db as never, 2);
    expect(context?.treasuryCashLedgerEnabled).toBe(true);
    const policy = resolveBankingPolicy(config as never);
    expect(policy.constructionFinance).toBe(true);
    expect(policy.sovereignPrimary).toBe(true);
  });

  it("is never switched on for a running world by a seed top-up", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [{ _id: "default" }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 400, preset: "1991-default" }]);
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });

    expect(db.collection("gameConfig").docs[0]).not.toHaveProperty("treasuryCashLedgerEnabled");
    const context = await loadTreasuryCashContext(db as never, 401);
    expect(context?.treasuryCashLedgerEnabled ?? false).toBe(false);
  });
});
